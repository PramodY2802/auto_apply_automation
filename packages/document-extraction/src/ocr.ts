import { run } from './tools';
import type { OcrLine } from './types';

export interface OcrResult {
  text: string;
  /** Mean word confidence 0..1 */
  confidence: number;
  lines: OcrLine[];
  engine: string;
}

export interface OCREngine {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  recognize(image: Buffer, opts?: { languages?: string[]; psm?: number }): Promise<OcrResult>;
}

/** Local Tesseract (CLI) engine. Uses TSV output to recover per-line layout and confidence. */
export class TesseractCliEngine implements OCREngine {
  readonly name = 'tesseract';
  constructor(private readonly binary = process.env.TESSERACT_PATH || 'tesseract') {}

  async isAvailable(): Promise<boolean> {
    try {
      await run(this.binary, ['--version'], { timeoutMs: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async recognize(image: Buffer, opts: { languages?: string[]; psm?: number } = {}): Promise<OcrResult> {
    const lang = (opts.languages?.length ? opts.languages : ['eng']).join('+');
    const { stdout } = await run(this.binary, ['stdin', 'stdout', '-l', lang, '--psm', String(opts.psm ?? 3), '--oem', '1', 'tsv'], {
      input: image,
      timeoutMs: 180_000,
    });
    return { ...parseTesseractTsv(stdout.toString('utf8')), engine: this.name };
  }
}

export function parseTesseractTsv(tsv: string): Omit<OcrResult, 'engine'> {
  const rows = tsv.split('\n').slice(1);
  const lines = new Map<string, { words: string[]; confs: number[]; x0: number; y0: number; x1: number; y1: number }>();
  const order: string[] = [];
  let confSum = 0;
  let confN = 0;
  for (const row of rows) {
    const cols = row.split('\t');
    if (cols.length < 12) continue;
    const [level, , block, par, line, , left, top, width, height, conf] = cols;
    const text = cols.slice(11).join('\t');
    if (level !== '5' || !text.trim()) continue;
    const c = Number(conf);
    const key = `${block}-${par}-${line}`;
    let l = lines.get(key);
    if (!l) {
      l = { words: [], confs: [], x0: Infinity, y0: Infinity, x1: 0, y1: 0 };
      lines.set(key, l);
      order.push(key);
    }
    l.words.push(text.trim());
    if (c >= 0) {
      l.confs.push(c);
      confSum += c;
      confN++;
    }
    const x = Number(left), y = Number(top), w = Number(width), h = Number(height);
    l.x0 = Math.min(l.x0, x);
    l.y0 = Math.min(l.y0, y);
    l.x1 = Math.max(l.x1, x + w);
    l.y1 = Math.max(l.y1, y + h);
  }
  const out: OcrLine[] = order.map((k) => {
    const l = lines.get(k)!;
    return {
      text: l.words.join(' '),
      confidence: l.confs.length ? l.confs.reduce((a, b) => a + b, 0) / l.confs.length / 100 : 0,
      bbox: { x: l.x0, y: l.y0, w: l.x1 - l.x0, h: l.y1 - l.y0 },
    };
  });
  // Reading order: top-to-bottom, then left-to-right for lines on the same row.
  out.sort((a, b) => (Math.abs(a.bbox.y - b.bbox.y) < Math.max(8, a.bbox.h / 2) ? a.bbox.x - b.bbox.x : a.bbox.y - b.bbox.y));
  // Insert blank lines for large vertical gaps (section breaks) to preserve layout.
  const textLines: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const prev = out[i - 1];
    if (prev && out[i]!.bbox.y - (prev.bbox.y + prev.bbox.h) > prev.bbox.h * 1.2) textLines.push('');
    textLines.push(out[i]!.text);
  }
  return { text: textLines.join('\n'), confidence: confN ? confSum / confN / 100 : 0, lines: out };
}

/**
 * Google Cloud Vision (DOCUMENT_TEXT_DETECTION). Implemented against the public
 * REST API; requires GOOGLE_VISION_API_KEY. Not exercised live in this repo's tests.
 */
export class GoogleVisionOcrEngine implements OCREngine {
  readonly name = 'google-vision';
  constructor(
    private readonly apiKey: string | undefined = process.env.GOOGLE_VISION_API_KEY,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async recognize(image: Buffer, opts: { languages?: string[] } = {}): Promise<OcrResult> {
    if (!this.apiKey) throw new Error('GOOGLE_VISION_API_KEY is not configured');
    const res = await this.fetchImpl('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        requests: [{ image: { content: image.toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: opts.languages ?? ['en'] } }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Google Vision returned ${res.status}`);
    const data: any = await res.json();
    const full = data?.responses?.[0]?.fullTextAnnotation;
    const pages = full?.pages ?? [];
    const confs: number[] = [];
    for (const p of pages) for (const b of p.blocks ?? []) if (typeof b.confidence === 'number') confs.push(b.confidence);
    return {
      text: full?.text ?? '',
      confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
      lines: [],
      engine: this.name,
    };
  }
}

/**
 * OCRService — engine selection is configurable (OCR_ENGINE=tesseract|google-vision)
 * and reusable for any document type, not just resumes.
 */
export class OCRService {
  private readonly engines = new Map<string, OCREngine>();
  constructor(engines: OCREngine[], private readonly preferred: string = process.env.OCR_ENGINE || 'tesseract') {
    for (const e of engines) this.engines.set(e.name, e);
  }

  static default(): OCRService {
    return new OCRService([new TesseractCliEngine(), new GoogleVisionOcrEngine()]);
  }

  async engine(): Promise<OCREngine> {
    const pref = this.engines.get(this.preferred);
    if (pref && (await pref.isAvailable())) return pref;
    for (const e of this.engines.values()) if (await e.isAvailable()) return e;
    throw new Error('No OCR engine is available (install tesseract-ocr or configure a cloud OCR key)');
  }

  async recognize(image: Buffer, opts?: { languages?: string[]; psm?: number }): Promise<OcrResult> {
    return (await this.engine()).recognize(image, opts);
  }
}
