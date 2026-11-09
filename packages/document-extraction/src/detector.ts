import crypto from 'node:crypto';
import { ExtractionError, type DetectedDocument } from './types';

const ALLOWED_EXT: Record<string, DetectedDocument['kind']> = {
  pdf: 'PDF',
  docx: 'DOCX',
  png: 'PNG',
  jpg: 'JPEG',
  jpeg: 'JPEG',
};

const MIME: Record<DetectedDocument['kind'], string> = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
};

/** Detects the real document type from magic bytes (never trusts the client-provided MIME type). */
export class DocumentTypeDetector {
  detect(buf: Buffer): DetectedDocument | null {
    if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return this.mk('PDF', 'pdf');
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return this.mk('PNG', 'png');
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return this.mk('JPEG', 'jpg');
    if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      // OOXML zip: look for the main document part name in the local file headers / central directory.
      const s = buf.toString('latin1');
      if (s.includes('word/document.xml')) return this.mk('DOCX', 'docx');
    }
    return null;
  }

  private mk(kind: DetectedDocument['kind'], extension: string): DetectedDocument {
    return { kind, extension, mimeType: MIME[kind] };
  }
}

export interface UploadValidationOptions {
  maxBytes: number;
  allowedKinds?: DetectedDocument['kind'][];
}

export interface ValidatedUpload {
  document: DetectedDocument;
  sha256: string;
  sizeBytes: number;
  safeFileName: string;
}

/**
 * DocumentUploadService: validates an uploaded file before it is stored.
 * Storage itself is handled by the API's StorageService.
 */
export class DocumentUploadService {
  constructor(private readonly detector = new DocumentTypeDetector()) {}

  validate(buf: Buffer, originalName: string, opts: UploadValidationOptions): ValidatedUpload {
    if (!buf.length) throw new ExtractionError('EMPTY', 'The uploaded file is empty');
    if (buf.length > opts.maxBytes) throw new ExtractionError('TOO_LARGE', `File exceeds the ${Math.round(opts.maxBytes / 1024 / 1024)} MB limit`);
    const doc = this.detector.detect(buf);
    if (!doc) throw new ExtractionError('UNSUPPORTED_TYPE', 'Unsupported file type. Upload a PDF, DOCX, PNG or JPEG.');
    if (opts.allowedKinds && !opts.allowedKinds.includes(doc.kind)) throw new ExtractionError('UNSUPPORTED_TYPE', `${doc.kind} files are not accepted here`);
    const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
    const claimed = ALLOWED_EXT[ext];
    if (claimed && claimed !== doc.kind) {
      throw new ExtractionError('MISMATCH', `File extension .${ext} does not match its contents (${doc.kind})`);
    }
    return {
      document: doc,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      sizeBytes: buf.length,
      safeFileName: sanitizeFileName(originalName, doc.extension),
    };
  }
}

export function sanitizeFileName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'document')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9 _.-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${base || 'document'}.${ext}`;
}
