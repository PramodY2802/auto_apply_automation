import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  PipeTransform,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { AIProviderError } from '@autoapply/ai-providers';
import { ExtractionError } from '@autoapply/document-extraction';
import { PlatformError, UnsupportedOperationError } from '@autoapply/platform-integrations';
import { createLogger, DomainError, type Container } from '@autoapply/services';
import type { EnterpriseRole, Permission, PlatformRole } from '@autoapply/shared';
import type { AppConfig } from '../config';

export const CONTAINER = Symbol('CONTAINER');
export const CONFIG = Symbol('CONFIG');
export const InjectContainer = () => Inject(CONTAINER);
export const InjectConfig = () => Inject(CONFIG);
export type { Container, AppConfig };

// ---------------------------------------------------------------------------
// Auth context
// ---------------------------------------------------------------------------
export interface AuthContext {
  userId: string;
  email: string;
  fullName: string;
  platformRole: PlatformRole;
  accountType: 'INDIVIDUAL' | 'ENTERPRISE';
  emailVerified: boolean;
  enterpriseId: string | null;
  enterpriseRole: EnterpriseRole | null;
  permissions: Set<Permission>;
  sessionId: string | null;
  apiTokenId: string | null;
  apiTokenScopes: string[];
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
  requestId?: string;
}

export const IS_PUBLIC = 'aa:isPublic';
export const PERMISSIONS_KEY = 'aa:permissions';
export const API_TOKEN_SCOPE = 'aa:apiTokenScope';

/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route requires all of the listed permissions. */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);
/** Route may be called with a personal API token carrying this scope (e.g. the browser extension). */
export const AllowApiToken = (scope: string) => SetMetadata(API_TOKEN_SCOPE, scope);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new HttpException('Unauthenticated', HttpStatus.UNAUTHORIZED);
  return req.auth;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip ?? null;
});

export function actorOf(a: AuthContext) {
  return { userId: a.userId, enterpriseId: a.enterpriseId };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodTypeAny) {}
  transform(value: unknown) {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) throw r.error;
    return r.data;
  }
}

/** Swagger body documentation generated from the zod schema. */
export function ApiZodBody(schema: z.ZodTypeAny) {
  return applyDecorators(ApiBody({ schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as any }));
}

export function parseUuid(v: string, name = 'id'): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new BadRequestException(`Invalid ${name}`);
  return v;
}

// ---------------------------------------------------------------------------
// Error mapping — consistent JSON errors, no stack traces or internals leaked.
// ---------------------------------------------------------------------------
const logger = createLogger('api');

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<AuthedRequest>();
    const { status, body } = mapError(err);
    if (status >= 500) logger.error('unhandled error', { requestId: req.requestId, path: req.path, error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 5).join(' | ') } : String(err) });
    res.status(status).json({ ...body, requestId: req.requestId });
  }
}

export function mapError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof ZodError) {
    return { status: 400, body: { code: 'VALIDATION', message: 'Invalid input', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } };
  }
  if (err instanceof ThrottlerException) return { status: 429, body: { code: 'RATE_LIMITED', message: 'Too many requests' } };
  if (err instanceof HttpException) {
    const r = err.getResponse();
    const message = typeof r === 'string' ? r : ((r as any).message ?? err.message);
    return { status: err.getStatus(), body: { code: (r as any)?.code ?? HttpStatus[err.getStatus()] ?? 'ERROR', message: Array.isArray(message) ? message.join('; ') : message } };
  }
  if (err instanceof DomainError) {
    const map: Record<DomainError['code'], number> = { NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, INVALID: 400, LIMIT_EXCEEDED: 402, FEATURE_UNAVAILABLE: 402, PRECONDITION: 422 };
    return { status: map[err.code], body: { code: err.code, message: err.message, details: err.details } };
  }
  if (err instanceof UnsupportedOperationError) return { status: 422, body: { code: 'UNSUPPORTED_OPERATION', message: err.message, capability: err.capability } };
  if (err instanceof PlatformError) return { status: err.code === 'CONFIG' ? 422 : 502, body: { code: `PLATFORM_${err.code}`, message: err.message } };
  if (err instanceof ExtractionError) return { status: err.code === 'TOO_LARGE' ? 413 : err.code === 'UNSUPPORTED_TYPE' || err.code === 'MISMATCH' ? 415 : 400, body: { code: err.code, message: err.message } };
  if (err instanceof AIProviderError) {
    const status = err.code === 'NOT_CONFIGURED' ? 422 : err.code === 'LIMIT_EXCEEDED' ? 402 : err.code === 'AUTH' ? 424 : 502;
    return { status, body: { code: `AI_${err.code}`, message: err.message } };
  }
  if ((err as any)?.code === '23505') return { status: 409, body: { code: 'CONFLICT', message: 'Resource already exists' } };
  return { status: 500, body: { code: 'INTERNAL', message: 'An unexpected error occurred' } };
}
