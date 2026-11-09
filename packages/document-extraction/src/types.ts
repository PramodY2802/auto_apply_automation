import type { ExtractedResume, ExtractionMethod } from '@autoapply/shared';

export type DocumentKind = 'PDF' | 'DOCX' | 'PNG' | 'JPEG';

export interface DetectedDocument {
  kind: DocumentKind;
  mimeType: string;
  extension: string;
}

export interface PageText {
  page: number;
  method: 'NATIVE_TEXT' | 'OCR' | 'DOCX';
  text: string;
  /** 0..1 OCR confidence; null for native text. */
  confidence: number | null;
  preprocessing?: string[];
  lines?: OcrLine[];
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface StepLog {
  step: string;
  status: 'ok' | 'skipped' | 'error';
  ms: number;
  detail?: string;
}

export interface TextExtractionResult {
  document: DetectedDocument;
  method: ExtractionMethod;
  pages: PageText[];
  text: string;
  ocrEngine: string | null;
  steps: StepLog[];
  warnings: string[];
}

export interface ResumeExtractionResult extends TextExtractionResult {
  structured: ExtractedResume;
  fieldConfidence: Record<string, number>;
  parser: 'ai' | 'heuristic';
  aiProvider: string | null;
  aiModel: string | null;
  errors: { step: string; message: string }[];
}

export class ExtractionError extends Error {
  constructor(
    public readonly code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY' | 'CORRUPT' | 'MISMATCH' | 'TOOL_FAILED' | 'NO_TEXT',
    message: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}
