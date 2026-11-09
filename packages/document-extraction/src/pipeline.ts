import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExtractionMethod } from '@autoapply/shared';
import { ResumeAIParser, type StructuredGenerator } from './ai-parser';
import { DocumentTypeDetector } from './detector';
import { HeuristicResumeParser } from './heuristic-parser';
import { CandidateProfileMapper } from './mapper';
import { OCRService } from './ocr';
import { ImagePreprocessor } from './preprocess';
import { DOCXExtractor, PDFTextExtractor, PdfRasterizer, withTempDir } from './tools';
import { ExtractionError, type PageText, type ResumeExtractionResult, type StepLog, type TextExtractionResult } from './types';
import { StructuredDataValidator } from './validator';

export interface PipelineDeps {
  detector?: DocumentTypeDetector;
  pdf?: PDFTextExtractor;
  rasterizer?: PdfRasterizer;
  docx?: DOCXExtractor;
  ocr?: OCRService;
  preprocessor?: ImagePreprocessor;
}

export interface TextExtractionOptions {
  maxPages?: number;
  ocrLanguages?: string[];
  /** Force OCR even on pages with a text layer (useful for broken text layers). */
  forceOcr?: boolean;
  onStep?: (s: StepLog) => void;
}

const LOW_OCR_CONFIDENCE = 0.6;

/**
 * Generic document → text pipeline (reusable for any document, not just resumes).
 * PDF pages with a text layer use native extraction; scanned pages are rasterised,
 * preprocessed and OCR'd (hybrid documents are handled page by page).
 */
export class DocumentTextPipeline {
  readonly detector: DocumentTypeDetector;
  readonly pdf: PDFTextExtractor;
  readonly rasterizer: PdfRasterizer;
  readonly docx: DOCXExtractor;
  readonly ocr: OCRService;
  readonly preprocessor: ImagePreprocessor;

  constructor(deps: PipelineDeps = {}) {
    this.detector = deps.detector ?? new DocumentTypeDetector();
    this.pdf = deps.pdf ?? new PDFTextExtractor();
    this.rasterizer = deps.rasterizer ?? new PdfRasterizer();
    this.docx = deps.docx ?? new DOCXExtractor();
    this.ocr = deps.ocr ?? OCRService.default();
    this.preprocessor = deps.preprocessor ?? new ImagePreprocessor();
  }

  async extract(buf: Buffer, opts: TextExtractionOptions = {}): Promise<TextExtractionResult> {
    const steps: StepLog[] = [];
    const warnings: string[] = [];
    const step = async <T>(name: string, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> => {
      const t = Date.now();
      try {
        const r = await fn();
        const s: StepLog = { step: name, status: 'ok', ms: Date.now() - t, detail: detail?.(r) };
        steps.push(s);
        opts.onStep?.(s);
        return r;
      } catch (e: any) {
        const s: StepLog = { step: name, status: 'error', ms: Date.now() - t, detail: e?.message };
        steps.push(s);
        opts.onStep?.(s);
        throw e;
      }
    };

    const document = await step('detect-type', async () => {
      const d = this.detector.detect(buf);
      if (!d) throw new ExtractionError('UNSUPPORTED_TYPE', 'Unsupported document type');
      return d;
    }, (d) => d.kind);

    let pages: PageText[] = [];
    let ocrEngine: string | null = null;
    const maxPages = opts.maxPages ?? 20;

    const ocrImage = async (img: Buffer, page: number): Promise<PageText> => {
      const pre = await step(`preprocess-page-${page}`, () => this.preprocessor.process(img), (r) => r.applied.join(','));
      let res = await step(`ocr-page-${page}`, () => this.ocr.recognize(pre.image, { languages: opts.ocrLanguages }), (r) => `${r.engine} conf=${r.confidence.toFixed(2)}`);
      let applied = pre.applied;
      if (res.confidence < LOW_OCR_CONFIDENCE) {
        // Retry with binarisation; keep whichever is more confident.
        const bin = await this.preprocessor.process(img, { binarize: true });
        const res2 = await step(`ocr-page-${page}-binarized`, () => this.ocr.recognize(bin.image, { languages: opts.ocrLanguages }), (r) => `conf=${r.confidence.toFixed(2)}`);
        if (res2.confidence > res.confidence) {
          res = res2;
          applied = bin.applied;
        }
        if (res.confidence < LOW_OCR_CONFIDENCE) warnings.push(`Page ${page}: low OCR confidence (${(res.confidence * 100).toFixed(0)}%) — please review extracted fields`);
      }
      ocrEngine = res.engine;
      return { page, method: 'OCR', text: res.text, confidence: Math.round(res.confidence * 1000) / 1000, preprocessing: applied, lines: res.lines };
    };

    if (document.kind === 'PDF') {
      await withTempDir(async (dir) => {
        const file = path.join(dir, 'doc.pdf');
        await fs.writeFile(file, buf);
        const count = await step('pdf-page-count', () => this.pdf.pageCount(file), (n) => `${n} pages`);
        if (count > maxPages) warnings.push(`Document has ${count} pages; only the first ${maxPages} were processed`);
        const native = await step('pdf-native-text', () => this.pdf.extract(file), (p) => `${p.filter(PDFTextExtractor.hasTextLayer).length}/${p.length} pages with text layer`);
        for (let i = 1; i <= Math.min(count, maxPages); i++) {
          const n = native[i - 1];
          if (n && PDFTextExtractor.hasTextLayer(n) && !opts.forceOcr) {
            pages.push(n);
          } else {
            const png = await step(`rasterize-page-${i}`, () => this.rasterizer.renderPage(file, i, dir));
            pages.push(await ocrImage(await fs.readFile(png), i));
          }
        }
      });
    } else if (document.kind === 'DOCX') {
      pages = await step('docx-text', () => this.docx.extract(buf));
    } else {
      pages = [await ocrImage(buf, 1)];
    }

    const text = pages.map((p) => p.text).join('\n\n');
    if (text.replace(/\s+/g, '').length < 20) throw new ExtractionError('NO_TEXT', 'No readable text could be extracted from the document');

    const methods = new Set(pages.map((p) => p.method));
    const method: ExtractionMethod = methods.size > 1 ? 'HYBRID' : methods.has('OCR') ? 'OCR' : methods.has('DOCX') ? 'DOCX' : 'NATIVE_TEXT';
    return { document, method, pages, text, ocrEngine, steps, warnings };
  }
}

export interface ResumePipelineOptions extends TextExtractionOptions {
  /** When omitted (no AI provider configured) the deterministic parser is used. */
  generator?: StructuredGenerator;
}

/**
 * Full resume pipeline: validate → detect → text/OCR → AI structured understanding
 * (with deterministic fallback) → strict schema + grounding validation.
 */
export class ResumeExtractionPipeline {
  constructor(
    private readonly text = new DocumentTextPipeline(),
    private readonly heuristic = new HeuristicResumeParser(),
    private readonly validator = new StructuredDataValidator(),
    readonly mapper = new CandidateProfileMapper(),
  ) {}

  async run(buf: Buffer, opts: ResumePipelineOptions = {}): Promise<ResumeExtractionResult> {
    const base = await this.text.extract(buf, { maxPages: 10, ...opts });
    const errors: { step: string; message: string }[] = [];
    const pageOf = (snippet: string) => {
      const s = snippet.trim().toLowerCase().slice(0, 40);
      if (!s) return null;
      return base.pages.find((p) => p.text.toLowerCase().includes(s))?.page ?? null;
    };
    const heuristic = this.heuristic.parse(base.text, pageOf);

    let candidate: unknown = heuristic;
    let parser: 'ai' | 'heuristic' = 'heuristic';
    let aiProvider: string | null = null;
    let aiModel: string | null = null;
    if (opts.generator) {
      const t = Date.now();
      try {
        const ai = await new ResumeAIParser(opts.generator).parse(base.pages);
        // Contact fields found deterministically fill gaps the model left empty.
        ai.resume.email ??= heuristic.email;
        ai.resume.phone ??= heuristic.phone;
        ai.resume.links.linkedin ??= heuristic.links.linkedin;
        ai.resume.links.github ??= heuristic.links.github;
        candidate = ai.resume;
        parser = 'ai';
        aiProvider = ai.provider;
        aiModel = ai.model;
        base.steps.push({ step: 'ai-structured-extraction', status: 'ok', ms: Date.now() - t, detail: `${ai.provider}/${ai.model}` });
      } catch (e: any) {
        errors.push({ step: 'ai-structured-extraction', message: e?.message ?? 'AI extraction failed' });
        base.steps.push({ step: 'ai-structured-extraction', status: 'error', ms: Date.now() - t, detail: e?.message });
        base.warnings.push('AI extraction failed; used the deterministic parser instead. Review fields carefully.');
      }
    } else {
      base.steps.push({ step: 'ai-structured-extraction', status: 'skipped', ms: 0, detail: 'No AI provider configured — deterministic parser used' });
    }

    const t = Date.now();
    const v = this.validator.validate(candidate, base.text);
    base.steps.push({ step: 'validate-and-ground', status: 'ok', ms: Date.now() - t, detail: `${v.warnings.length} warnings` });

    // OCR uncertainty propagates into field confidence.
    const ocrConf = base.pages.filter((p) => p.method === 'OCR').map((p) => p.confidence ?? 0);
    const fieldConfidence = { ...v.fieldConfidence };
    if (ocrConf.length) {
      const f = Math.min(1, Math.max(0.3, Math.min(...ocrConf) + 0.15));
      for (const k of Object.keys(fieldConfidence)) fieldConfidence[k] = Math.round(fieldConfidence[k]! * f * 100) / 100;
    }

    return {
      ...base,
      warnings: [...base.warnings, ...v.warnings],
      structured: { ...v.resume, confidence: fieldConfidence },
      fieldConfidence,
      parser,
      aiProvider,
      aiModel,
      errors,
    };
  }
}
