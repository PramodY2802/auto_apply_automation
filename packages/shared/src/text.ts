/** Text normalization helpers shared by matching, dedupe and answer generation. */

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|ltd|limited|pvt|private|corp|corporation|co|company|gmbh|plc|sa|ag|technologies|technology|solutions|labs)\b\.?/g;

export function normalizeCompany(name: string): string {
  return normalizeWhitespace(
    name
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(COMPANY_SUFFIXES, ' '),
  );
}

const TITLE_SYNONYMS: [RegExp, string][] = [
  [/\bsr\.?\b/g, 'senior'],
  [/\bjr\.?\b/g, 'junior'],
  [/\bswe\b/g, 'software engineer'],
  [/\bsde\b/g, 'software development engineer'],
  [/\bdev\b/g, 'developer'],
  [/\beng\b/g, 'engineer'],
  [/\bmgr\b/g, 'manager'],
  [/\bfullstack\b|\bfull-stack\b/g, 'full stack'],
  [/\bfront-end\b|\bfrontend\b/g, 'front end'],
  [/\bback-end\b|\bbackend\b/g, 'back end'],
];

export function normalizeTitle(title: string): string {
  let t = title.toLowerCase();
  for (const [re, rep] of TITLE_SYNONYMS) t = t.replace(re, rep);
  t = t.replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9+# ]/g, ' ');
  return normalizeWhitespace(t);
}

export function tokenize(s: string): string[] {
  return normalizeWhitespace(s.toLowerCase().replace(/[^a-z0-9+# ]/g, ' '))
    .split(' ')
    .filter((t) => t.length > 1 || t === 'c' || t === 'r');
}

/** Jaccard similarity of token sets. */
export function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Normalize a free-form question into a reuse key for saved answers. */
export function normalizeQuestionKey(q: string): string {
  return normalizeWhitespace(q.toLowerCase().replace(/[*?:.!()"']/g, ' ').replace(/\b(please|kindly|your|you|the|a|an|do|are)\b/g, ' '));
}

/** Redact obvious secrets/PII from strings before logging. */
export function redactForLog(s: string): string {
  return s
    .replace(/(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '$1-***')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
    .replace(/(\+\d[\d\s().-]{7,}\d)|(\(?\d{3,5}\)?[\s.-]\d{3,5}[\s.-]\d{3,5})|(\b\d{4,5}[\s.-]\d{5,6}\b)/g, '***phone***');
}
