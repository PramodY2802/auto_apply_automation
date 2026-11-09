import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, resumeExtractions, resumes } from '@autoapply/database';
import { CandidateProfileMapper, DocumentUploadService } from '@autoapply/document-extraction';
import { DomainError, QUEUES } from '@autoapply/services';
import { candidateProfileUpdateSchema, preferencesSchema, type CandidateProfileUpdate, type PreferencesInput } from '@autoapply/shared';
import { ApiZodBody, Auth, InjectConfig, InjectContainer, RequirePermissions, ZodPipe, actorOf, parseUuid, type AppConfig, type AuthContext, type Container } from '../../common/core';

@ApiTags('resumes')
@RequirePermissions('profile:manage')
@Controller({ path: 'resumes', version: '1' })
export class ResumesController {
  private readonly uploads = new DocumentUploadService();
  constructor(@InjectContainer() private readonly c: Container, @InjectConfig() private readonly config: AppConfig) {}

  private async owned(a: AuthContext, id: string) {
    const [r] = await this.c.db.select().from(resumes).where(and(eq(resumes.id, parseUuid(id)), eq(resumes.userId, a.userId), isNull(resumes.deletedAt)));
    if (!r) throw new DomainError('NOT_FOUND', 'Resume not found');
    return r;
  }

  private async enqueueExtraction(a: AuthContext, resumeId: string) {
    const [ex] = await this.c.db.insert(resumeExtractions).values({ resumeId, userId: a.userId, status: 'PENDING' }).returning();
    await this.c.queues!.add(QUEUES.DOCUMENTS, { extractionId: ex!.id, userId: a.userId }, { idempotencyKey: `extract:${ex!.id}` });
    return ex!;
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, label: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  async upload(@Auth() a: AuthContext, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: { label?: string }) {
    if (!file) throw new DomainError('INVALID', 'Attach a file in the "file" field');
    const v = this.uploads.validate(file.buffer, file.originalname, { maxBytes: this.config.MAX_UPLOAD_MB * 1024 * 1024 });
    await this.c.usage.assertWithin(actorOf(a), 'STORAGE_BYTES', v.sizeBytes);
    const [dup] = await this.c.db.select().from(resumes).where(and(eq(resumes.userId, a.userId), eq(resumes.sha256, v.sha256), isNull(resumes.deletedAt)));
    if (dup) throw new DomainError('CONFLICT', 'You already uploaded this exact file', { resumeId: dup.id });
    const key = `resumes/${a.userId}/${randomUUID()}.${v.document.extension}`;
    await this.c.storage.put(key, file.buffer, v.document.mimeType);
    const existing = await this.c.db.select({ id: resumes.id }).from(resumes).where(and(eq(resumes.userId, a.userId), isNull(resumes.deletedAt)));
    const [r] = await this.c.db
      .insert(resumes)
      .values({ userId: a.userId, enterpriseId: a.enterpriseId, fileName: v.safeFileName, mimeType: v.document.mimeType, sizeBytes: v.sizeBytes, storageKey: key, sha256: v.sha256, isPrimary: existing.length === 0, label: body?.label?.slice(0, 80) ?? null })
      .returning();
    const ex = await this.enqueueExtraction(a, r!.id);
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: a.enterpriseId, action: 'resume.upload', targetType: 'resume', targetId: r!.id, metadata: { kind: v.document.kind, sizeBytes: v.sizeBytes } });
    const { storageKey: _k, sha256: _s, ...safe } = r!;
    return { resume: safe, extractionId: ex.id };
  }

  @Get()
  async list(@Auth() a: AuthContext) {
    const rows = await this.c.db
      .select({ id: resumes.id, fileName: resumes.fileName, mimeType: resumes.mimeType, sizeBytes: resumes.sizeBytes, isPrimary: resumes.isPrimary, status: resumes.status, label: resumes.label, createdAt: resumes.createdAt })
      .from(resumes)
      .where(and(eq(resumes.userId, a.userId), isNull(resumes.deletedAt)))
      .orderBy(desc(resumes.createdAt));
    return rows;
  }

  @Get(':id/extraction')
  async extraction(@Auth() a: AuthContext, @Param('id') id: string) {
    const r = await this.owned(a, id);
    const [ex] = await this.c.db.select().from(resumeExtractions).where(eq(resumeExtractions.resumeId, r.id)).orderBy(desc(resumeExtractions.createdAt)).limit(1);
    if (!ex) throw new DomainError('NOT_FOUND', 'No extraction yet');
    return { resume: { id: r.id, fileName: r.fileName, status: r.status }, extraction: ex };
  }

  @Post(':id/extraction/apply')
  @HttpCode(200)
  async applyExtraction(@Auth() a: AuthContext, @Param('id') id: string) {
    const r = await this.owned(a, id);
    const [ex] = await this.c.db.select().from(resumeExtractions).where(and(eq(resumeExtractions.resumeId, r.id), eq(resumeExtractions.status, 'SUCCEEDED'))).orderBy(desc(resumeExtractions.createdAt)).limit(1);
    if (!ex?.structured) throw new DomainError('PRECONDITION', 'No successful extraction to apply');
    await this.c.profiles.update(a.userId, a.enterpriseId, { ...new CandidateProfileMapper().toProfileUpdate(ex.structured), sourceResumeId: r.id, fieldConfidence: ex.fieldConfidence }, 'RESUME');
    return this.c.profiles.getFull(a.userId);
  }

  @Post(':id/reprocess')
  @HttpCode(202)
  async reprocess(@Auth() a: AuthContext, @Param('id') id: string) {
    const r = await this.owned(a, id);
    const ex = await this.enqueueExtraction(a, r.id);
    return { extractionId: ex.id };
  }

  @Post(':id/primary')
  @HttpCode(204)
  async primary(@Auth() a: AuthContext, @Param('id') id: string) {
    const r = await this.owned(a, id);
    await this.c.db.transaction(async (tx) => {
      await tx.update(resumes).set({ isPrimary: false }).where(eq(resumes.userId, a.userId));
      await tx.update(resumes).set({ isPrimary: true }).where(eq(resumes.id, r.id));
    });
  }

  @Get(':id/file')
  async download(@Auth() a: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.owned(a, id);
    const buf = await this.c.storage.get(r.storageKey);
    res.set({ 'Content-Type': r.mimeType, 'Content-Disposition': `attachment; filename="${r.fileName.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store' });
    return new StreamableFile(buf);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    const r = await this.owned(a, id);
    await this.c.db.update(resumes).set({ deletedAt: new Date(), isPrimary: false }).where(eq(resumes.id, r.id));
    await this.c.storage.delete(r.storageKey).catch(() => undefined);
    // Remove extracted text too (retention: no orphaned personal data).
    await this.c.db.update(resumeExtractions).set({ rawText: null, pages: [] }).where(eq(resumeExtractions.resumeId, r.id));
    if (r.isPrimary) {
      const [next] = await this.c.db.select().from(resumes).where(and(eq(resumes.userId, a.userId), isNull(resumes.deletedAt))).orderBy(desc(resumes.createdAt)).limit(1);
      if (next) await this.c.db.update(resumes).set({ isPrimary: true }).where(eq(resumes.id, next.id));
    }
    await this.c.audit.log({ actorUserId: a.userId, action: 'resume.delete', targetType: 'resume', targetId: r.id });
  }
}

@ApiTags('profile')
@RequirePermissions('profile:manage')
@Controller({ version: '1' })
export class ProfileController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Get('profile')
  async get(@Auth() a: AuthContext) {
    return (await this.c.profiles.getFull(a.userId)) ?? { userId: a.userId, experiences: [], education: [], skills: [], extras: { certifications: [], projects: [], achievements: [], previousTitles: [] }, links: {}, reviewedAt: null };
  }

  @Put('profile')
  @ApiZodBody(candidateProfileUpdateSchema)
  async update(@Auth() a: AuthContext, @Body(new ZodPipe(candidateProfileUpdateSchema)) body: CandidateProfileUpdate) {
    await this.c.profiles.update(a.userId, a.enterpriseId, body, 'USER');
    await this.c.queues!.add(QUEUES.MATCHING, { userId: a.userId }, { idempotencyKey: `rematch:${a.userId}:${Math.floor(Date.now() / 10_000)}` });
    return this.c.profiles.getFull(a.userId);
  }

  @Get('preferences')
  async getPrefs(@Auth() a: AuthContext) {
    return this.c.profiles.getPreferences(a.userId);
  }

  @Put('preferences')
  @ApiZodBody(preferencesSchema)
  async savePrefs(@Auth() a: AuthContext, @Body(new ZodPipe(preferencesSchema)) body: PreferencesInput) {
    if (body.applicationMode === 'AUTOMATIC') await this.c.usage.assertFeature(actorOf(a), 'autoApply');
    if (body.searchFrequency !== 'MANUAL') await this.c.usage.assertFeature(actorOf(a), 'scheduledSearch');
    const prev = await this.c.profiles.getPreferences(a.userId);
    const saved = await this.c.profiles.savePreferences(a.userId, body);
    if (!prev?.autoApplyConsentAt && saved.autoApplyConsentAt) {
      await this.c.audit.log({ actorUserId: a.userId, enterpriseId: a.enterpriseId, action: 'auto_apply.consent_granted', metadata: { minScore: body.autoApplyMinScore, dailyLimit: body.dailyApplicationLimit } });
    }
    await this.c.queues!.add(QUEUES.MATCHING, { userId: a.userId }, { idempotencyKey: `rematch:${a.userId}:${Math.floor(Date.now() / 10_000)}` });
    return saved;
  }
}
