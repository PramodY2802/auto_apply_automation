import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mammoth from 'mammoth';
import { ExtractionError, type PageText } from './types';

export function run(cmd: string, args: string[], opts: { timeoutMs?: number; input?: Buffer } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 120_000 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr as Buffer | undefined)?.toString('utf8').slice(0, 500) || err.message;
          reject(new ExtractionError('TOOL_FAILED', `${cmd} failed: ${msg}`));
          return;
        }
        resolve({ stdout: stdout as Buffer, stderr: (stderr as Buffer).toString('utf8') });
      },
    );
    if (opts.input && child.stdin) {
      child.stdin.end(opts.input);
    }
  });
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoapply-doc-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Minimum meaningful characters for a PDF page to count as "has a text layer". */
export const TEXT_LAYER_MIN_CHARS = 40;

/** PDFTextExtractor — native text extraction via poppler's pdftotext (layout preserved, per page). */
export class PDFTextExtractor {
  async pageCount(pdfPath: string): Promise<number> {
    const { stdout } = await run('pdfinfo', [pdfPath], { timeoutMs: 30_000 });
    const m = /Pages:\s+(\d+)/.exec(stdout.toString('utf8'));
    if (!m) throw new ExtractionError('CORRUPT', 'Could not read PDF page count (file may be corrupt or encrypted)');
    return Number(m[1]);
  }

  async extract(pdfPath: string): Promise<PageText[]> {
    const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], { timeoutMs: 60_000 });
    const pages = stdout.toString('utf8').split('\f');
    if (pages.length && pages[pages.length - 1]!.trim() === '') pages.pop();
    return pages.map((text, i) => ({ page: i + 1, method: 'NATIVE_TEXT' as const, text: cleanText(text), confidence: null }));
  }

  /** True when a page's native text layer is substantive. */
  static hasTextLayer(page: PageText): boolean {
    return page.text.replace(/\s+/g, '').length >= TEXT_LAYER_MIN_CHARS;
  }
}

/** Renders PDF pages to PNG for OCR (poppler pdftoppm). */
export class PdfRasterizer {
  async renderPage(pdfPath: string, page: number, outDir: string, dpi = 300): Promise<string> {
    const prefix = path.join(outDir, `p${page}`);
    await run('pdftoppm', ['-r', String(dpi), '-f', String(page), '-l', String(page), '-png', '-singlefile', '-gray', pdfPath, prefix], { timeoutMs: 120_000 });
    return `${prefix}.png`;
  }
}

/** DOCXExtractor — raw text from Word documents (mammoth). */
export class DOCXExtractor {
  async extract(buf: Buffer): Promise<PageText[]> {
    try {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return [{ page: 1, method: 'DOCX', text: cleanText(value), confidence: null }];
    } catch (e: any) {
      throw new ExtractionError('CORRUPT', `Could not read DOCX: ${e?.message ?? 'unknown error'}`);
    }
  }
}

export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
