import { extractedResumeSchema, type ExtractedResume } from '@autoapply/shared';
import type { PageText } from './types';

/**
 * Port to the AI layer (implemented by the API/worker using AIProviderRouter.generateStructured).
 * Kept as a function type so this package has no runtime dependency on provider credentials.
 */
export type StructuredGenerator = (args: {
  system: string;
  prompt: string;
  schemaName: string;
  maxTokens: number;
}) => Promise<{ data: unknown; provider: string; model: string }>;

export const RESUME_SYSTEM_PROMPT = `You are a precise resume information extraction engine.
Rules:
- Extract ONLY information explicitly present in the resume text. Never infer, embellish, or invent.
- If a field is not present, use null (or an empty array). Do not guess employers, dates, degrees, certifications or skills.
- Copy names, companies, titles, institutions and certification names exactly as written.
- Dates: use "YYYY-MM" when month and year are given, "YYYY" when only the year is given, "present" for current roles.
- Do not write a summary; only copy a summary/profile/objective section if the resume has one.
- totalExperienceMonths: only if the resume states it or it can be computed from listed dates; else null.
- sourcePage: the page number marker ("=== Page N ===") where the item appears.
- confidence: map of field path → 0..1 for how clearly the value appears (e.g. "fullName": 0.95, "experiences.0": 0.8). Lower it for OCR-garbled text.
Return a single JSON object.`;

const MAX_CHARS = 28_000;

export class ResumeAIParser {
  constructor(private readonly generate: StructuredGenerator) {}

  buildPrompt(pages: PageText[]): string {
    let body = pages.map((p) => `=== Page ${p.page}${p.method === 'OCR' ? ` (OCR, confidence ${(p.confidence ?? 0).toFixed(2)})` : ''} ===\n${p.text}`).join('\n\n');
    if (body.length > MAX_CHARS) body = body.slice(0, MAX_CHARS) + '\n[...truncated]';
    return `Extract the candidate profile from this resume.\n\n<resume>\n${body}\n</resume>`;
  }

  async parse(pages: PageText[]): Promise<{ resume: ExtractedResume; provider: string; model: string }> {
    const { data, provider, model } = await this.generate({
      system: RESUME_SYSTEM_PROMPT,
      prompt: this.buildPrompt(pages),
      schemaName: 'extracted_resume',
      maxTokens: 6000,
    });
    // Strict validation happens in StructuredDataValidator; parse here for typing.
    return { resume: extractedResumeSchema.parse(data), provider, model };
  }
}
