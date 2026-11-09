import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  DocumentTypeDetector,
  DocumentUploadService,
  DocumentTextPipeline,
  HeuristicResumeParser,
  ImagePreprocessor,
  ResumeExtractionPipeline,
  StructuredDataValidator,
  computeExperienceMonths,
  estimateSkew,
  parseResumeDate,
  parseTesseractTsv,
  splitTitleCompany,
} from './index';

const fx = (n: string) => fs.readFileSync(path.join(__dirname, '__fixtures__', n));

describe('DocumentTypeDetector / upload validation', () => {
  const d = new DocumentTypeDetector();
  it('detects by magic bytes', () => {
    expect(d.detect(fx('resume.pdf'))?.kind).toBe('PDF');
    expect(d.detect(fx('resume.docx'))?.kind).toBe('DOCX');
    expect(d.detect(fx('resume-rotated.png'))?.kind).toBe('PNG');
    expect(d.detect(Buffer.from('hello world'))).toBeNull();
  });
  it('rejects mismatched extension, empty and oversized files', () => {
    const u = new DocumentUploadService();
    expect(() => u.validate(fx('resume.pdf'), 'cv.docx', { maxBytes: 1e7 })).toThrow(/does not match/);
    expect(() => u.validate(Buffer.alloc(0), 'cv.pdf', { maxBytes: 1e7 })).toThrow(/empty/);
    expect(() => u.validate(fx('resume.pdf'), 'cv.pdf', { maxBytes: 10 })).toThrow(/limit/);
    expect(() => u.validate(Buffer.from('MZ....'), 'cv.exe', { maxBytes: 1e7 })).toThrow(/Unsupported/);
    const ok = u.validate(fx('resume.pdf'), '../../etc/My CV!.pdf', { maxBytes: 1e7 });
    expect(ok.safeFileName).toBe('My CV_.pdf');
    expect(ok.sha256).toHaveLength(64);
  });
});

describe('date + experience helpers', () => {
  it('parses resume dates', () => {
    expect(parseResumeDate('Jan 2021')).toBe('2021-01');
    expect(parseResumeDate('September 2019')).toBe('2019-09');
    expect(parseResumeDate('07/2017')).toBe('2017-07');
    expect(parseResumeDate('Present')).toBe('present');
    expect(parseResumeDate('soon')).toBeNull();
  });
  it('merges overlapping intervals', () => {
    const now = new Date(Date.UTC(2024, 11, 15));
    expect(computeExperienceMonths([{ startDate: '2020-01', endDate: '2020-12' }, { startDate: '2020-06', endDate: '2021-05' }], now)).toBe(17);
    expect(computeExperienceMonths([{ startDate: '2024-01', endDate: 'present' }], now)).toBe(12);
  });
  it('splits title/company', () => {
    expect(splitTitleCompany('Senior Software Engineer, Northwind Labs')).toEqual({ title: 'Senior Software Engineer', company: 'Northwind Labs' });
    expect(splitTitleCompany('Backend Developer at Acme')).toEqual({ title: 'Backend Developer', company: 'Acme' });
  });
});

describe('Tesseract TSV parsing', () => {
  it('groups words into lines with confidence', () => {
    const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n' +
      '5\t1\t1\t1\t1\t1\t10\t10\t50\t20\t90\tHello\n5\t1\t1\t1\t1\t2\t70\t10\t50\t20\t80\tWorld\n5\t1\t1\t1\t2\t1\t10\t100\t50\t20\t70\tNext';
    const r = parseTesseractTsv(tsv);
    expect(r.text).toBe('Hello World\n\nNext');
    expect(r.confidence).toBeCloseTo(0.8);
    expect(r.lines[0]!.confidence).toBeCloseTo(0.85);
  });
});

describe('StructuredDataValidator — never invents', () => {
  const text = 'Jane Doe\njane@example.com\nEXPERIENCE\nBackend Engineer, Acme Corp  Jan 2020 - Dec 2021\nSKILLS\nPython, PostgreSQL';
  const v = new StructuredDataValidator();
  it('removes ungrounded employers, certifications, skills and summaries', () => {
    const out = v.validate(
      {
        fullName: 'Jane Doe', email: 'jane@example.com', phone: null, location: null,
        summary: 'Visionary leader with 15 years at Google.', currentTitle: 'Backend Engineer', totalExperienceMonths: 180,
        experiences: [
          { company: 'Acme Corp', title: 'Backend Engineer', startDate: '2020-01', endDate: '2021-12', isCurrent: false },
          { company: 'Google', title: 'Staff Engineer', startDate: '2010-01', endDate: '2019-12', isCurrent: false },
        ],
        skills: { technical: [], soft: [], programmingLanguages: ['Python', 'Rust'], frameworks: [], databases: ['PostgreSQL'], cloud: ['AWS'], tools: [] },
        certifications: [{ name: 'AWS Certified Solutions Architect' }],
      },
      text,
    );
    expect(out.resume.experiences).toHaveLength(1);
    expect(out.resume.summary).toBeNull();
    expect(out.resume.certifications).toHaveLength(0);
    expect(out.resume.skills.programmingLanguages).toEqual(['Python']);
    expect(out.resume.skills.cloud).toEqual([]);
    expect(out.resume.totalExperienceMonths).toBe(24);
    expect(out.warnings.join(' ')).toMatch(/Google/);
  });
  it('rejects schema-invalid output', () => {
    expect(() => v.validate({ fullName: 5 }, text)).toThrow(/schema/);
  });
});

describe('extraction pipeline on real documents', () => {
  const pipeline = new ResumeExtractionPipeline();

  it('extracts a text PDF natively', async () => {
    const r = await pipeline.run(fx('resume.pdf'));
    expect(r.method).toBe('NATIVE_TEXT');
    expect(r.parser).toBe('heuristic');
    expect(r.structured.fullName).toBe('Arjun Mehta');
    expect(r.structured.email).toBe('arjun.mehta@example.com');
    expect(r.structured.phone).toContain('98765');
    expect(r.structured.links.github).toContain('github.com/arjunmehta-dev');
    expect(r.structured.experiences.map((e) => e.company)).toEqual(['Northwind Labs', 'Contoso Systems']);
    expect(r.structured.experiences[0]!.isCurrent).toBe(true);
    expect(r.structured.skills.programmingLanguages).toEqual(expect.arrayContaining(['Python', 'TypeScript']));
    expect(r.structured.education[0]!.institution).toBe('VIT University');
    expect(r.structured.certifications[0]!.name).toMatch(/AWS Certified Solutions Architect/);
    expect(r.structured.totalExperienceMonths).toBeGreaterThan(80);
  });

  it('extracts DOCX', async () => {
    const r = await pipeline.run(fx('resume.docx'));
    expect(r.method).toBe('DOCX');
    expect(r.structured.email).toBe('arjun.mehta@example.com');
    expect(r.structured.experiences).toHaveLength(2);
  });

  it('OCRs a skewed, noisy scanned PDF (deskew + denoise)', async () => {
    const r = await pipeline.run(fx('resume-scanned.pdf'));
    expect(r.method).toBe('OCR');
    expect(r.ocrEngine).toBe('tesseract');
    expect(r.pages[0]!.preprocessing!.some((p) => p.startsWith('deskew'))).toBe(true);
    expect(r.structured.email).toBe('arjun.mehta@example.com');
    expect(r.structured.skills.databases).toEqual(expect.arrayContaining(['PostgreSQL']));
    expect(r.pages[0]!.confidence!).toBeGreaterThan(0.7);
  });

  it('OCRs a 90°-rotated PNG (orientation correction)', async () => {
    const r = await pipeline.run(fx('resume-rotated.png'));
    expect(r.pages[0]!.preprocessing!.some((p) => p.startsWith('rotate-'))).toBe(true);
    expect(r.structured.email).toBe('arjun.mehta@example.com');
    expect(r.structured.fullName).toBe('Arjun Mehta');
  });

  it('uses the AI generator when provided and still grounds its output', async () => {
    const generator = async () => ({
      provider: 'mock',
      model: 'mock-deterministic',
      data: {
        fullName: 'Arjun Mehta', email: null, phone: null, location: 'Bengaluru, India', summary: null, currentTitle: 'Senior Software Engineer', totalExperienceMonths: null,
        experiences: [{ company: 'Northwind Labs', title: 'Senior Software Engineer', startDate: '2021-01', endDate: 'present', isCurrent: true }, { company: 'Initech', title: 'CTO', startDate: '2010', endDate: '2016' }],
        skills: { programmingLanguages: ['Python', 'Haskell'] },
        confidence: { fullName: 0.99 },
      },
    });
    const r = await pipeline.run(fx('resume.pdf'), { generator });
    expect(r.parser).toBe('ai');
    expect(r.structured.email).toBe('arjun.mehta@example.com'); // filled from deterministic contact parse
    expect(r.structured.experiences.map((e) => e.company)).toEqual(['Northwind Labs']); // Initech removed
    expect(r.structured.skills.programmingLanguages).toEqual(['Python']);
    expect(r.warnings.some((w) => w.includes('Initech'))).toBe(true);
  });

  it('falls back to deterministic parsing when the AI call fails', async () => {
    const r = await pipeline.run(fx('resume.pdf'), { generator: async () => { throw new Error('provider down'); } });
    expect(r.parser).toBe('heuristic');
    expect(r.errors[0]!.message).toBe('provider down');
    expect(r.structured.fullName).toBe('Arjun Mehta');
  });
});

describe('image preprocessing', () => {
  it('estimates skew of a rotated text image', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `<text x="40" y="${60 + i * 36}" font-size="24" font-family="DejaVu Sans">Line ${i} of sample resume text for skew estimation</text>`).join('');
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="100%" height="100%" fill="white"/>${lines}</svg>`);
    const base = await sharp(svg).png().toBuffer();
    expect(Math.abs(await estimateSkew(base))).toBeLessThan(0.5);
    const rotated = await sharp(base).rotate(4, { background: '#fff' }).png().toBuffer();
    const s = await estimateSkew(rotated);
    expect(Math.abs(Math.abs(s) - 4)).toBeLessThan(0.75);
    const pre = await new ImagePreprocessor().process(rotated, { orientation: false });
    expect(pre.applied.some((a) => a.startsWith('deskew'))).toBe(true);
    expect(Math.abs(await estimateSkew(pre.image))).toBeLessThan(0.75);
  });
});

describe('generic text pipeline', () => {
  it('is reusable for non-resume documents', async () => {
    const r = await new DocumentTextPipeline().extract(fx('resume.pdf'));
    expect(r.text).toContain('Northwind Labs');
    expect(r.steps.find((s) => s.step === 'pdf-native-text')?.status).toBe('ok');
  });
  it('heuristic parser handles empty sections gracefully', () => {
    const r = new HeuristicResumeParser().parse('Just a line of text without anything');
    expect(r.experiences).toEqual([]);
    expect(r.fullName).toBeNull();
  });
});
