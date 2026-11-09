import crypto from 'node:crypto';
import http from 'node:http';
import Busboy from 'busboy';

/**
 * Sandbox Job Board — a controlled test environment that behaves like a small
 * job board: JSON search API, job pages with schema.org JSON-LD, HTML
 * application forms (incl. file upload, selects, radios, consent checkbox),
 * server-side validation, a confirmation page with a reference number, a
 * CAPTCHA-protected posting, and a status API. It lets discovery and browser
 * automation be tested end-to-end without touching any real job portal.
 */

export interface SandboxJob {
  id: string;
  title: string;
  company: string;
  location: string;
  city: string | null;
  country: string;
  workMode: 'REMOTE' | 'HYBRID' | 'ONSITE';
  employmentType: 'FULL_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'PART_TIME';
  description: string;
  primarySkill: string;
  salary: { min: number; max: number; currency: string; period: 'YEAR' | 'MONTH' | 'HOUR' } | null;
  postedDaysAgo: number;
  captcha?: boolean;
}

export interface SandboxApplication {
  ref: string;
  jobId: string;
  status: 'RECEIVED' | 'REVIEWING' | 'INTERVIEW' | 'REJECTED' | 'OFFER';
  receivedAt: string;
  fields: Record<string, string>;
  resume: { fileName: string; bytes: number; mimeType: string } | null;
}

const d = (s: string) => s.trim().replace(/\n\s+/g, '\n');

export const SANDBOX_JOBS: SandboxJob[] = [
  { id: 'sbx-1001', title: 'Senior Backend Engineer (Python)', company: 'Northbridge Payments', location: 'Bengaluru, India', city: 'Bengaluru', country: 'India', workMode: 'HYBRID', employmentType: 'FULL_TIME', primarySkill: 'Python', salary: { min: 3_000_000, max: 4_500_000, currency: 'INR', period: 'YEAR' }, postedDaysAgo: 2,
    description: d(`<p>Build the payments ledger used by millions of merchants.</p>
      <h3>Requirements</h3><ul><li>5+ years of professional experience</li><li>Python and Django</li><li>PostgreSQL and Redis</li><li>AWS</li></ul>
      <h3>Nice to have</h3><ul><li>Kubernetes</li><li>Kafka</li></ul>`) },
  { id: 'sbx-1002', title: 'Backend Developer - Node.js', company: 'Lumen Health', location: 'Remote - India', city: null, country: 'India', workMode: 'REMOTE', employmentType: 'FULL_TIME', primarySkill: 'Node.js', salary: { min: 2_000_000, max: 3_200_000, currency: 'INR', period: 'YEAR' }, postedDaysAgo: 5,
    description: d(`<p>Own clinical data APIs.</p><h3>Requirements</h3><ul><li>3-6 years of experience</li><li>Node.js, TypeScript, PostgreSQL</li><li>REST APIs, Docker</li></ul><h3>Preferred</h3><ul><li>GraphQL</li></ul>`) },
  { id: 'sbx-1003', title: 'Software Engineer, Platform', company: 'Orbit Logistics', location: 'Pune, India', city: 'Pune', country: 'India', workMode: 'ONSITE', employmentType: 'FULL_TIME', primarySkill: 'Java', salary: null, postedDaysAgo: 1,
    description: d(`<p>Routing optimisation platform.</p><h3>Requirements</h3><ul><li>2+ years</li><li>Java, Spring Boot, MySQL</li></ul>`) },
  { id: 'sbx-1004', title: 'Python Developer', company: 'Quanta Analytics', location: 'Hyderabad, India', city: 'Hyderabad', country: 'India', workMode: 'HYBRID', employmentType: 'CONTRACT', primarySkill: 'Python', salary: { min: 150_000, max: 220_000, currency: 'INR', period: 'MONTH' }, postedDaysAgo: 9,
    description: d(`<p>Data pipelines for retail analytics.</p><h3>Requirements</h3><ul><li>3-5 years of experience</li><li>Python, Pandas, Airflow, SQL</li></ul><h3>Nice to have</h3><ul><li>Apache Spark</li><li>Snowflake</li></ul>`) },
  { id: 'sbx-1005', title: 'Full Stack Developer', company: 'Brightlane Studio', location: 'Remote', city: null, country: 'India', workMode: 'REMOTE', employmentType: 'FULL_TIME', primarySkill: 'React', salary: { min: 1_800_000, max: 2_600_000, currency: 'INR', period: 'YEAR' }, postedDaysAgo: 3,
    description: d(`<p>Ship product features end to end.</p><h3>Requirements</h3><ul><li>2-5 years of experience</li><li>React, TypeScript, Node.js, PostgreSQL</li></ul>`) },
  { id: 'sbx-1006', title: 'DevOps Engineer', company: 'Cirrus Cloudworks', location: 'Bengaluru, India', city: 'Bengaluru', country: 'India', workMode: 'HYBRID', employmentType: 'FULL_TIME', primarySkill: 'Kubernetes', salary: { min: 2_500_000, max: 3_800_000, currency: 'INR', period: 'YEAR' }, postedDaysAgo: 4,
    description: d(`<p>Run our multi-region Kubernetes estate.</p><h3>Requirements</h3><ul><li>4+ years</li><li>Kubernetes, Terraform, AWS, Linux</li></ul><h3>Bonus</h3><ul><li>Python</li></ul>`) },
  { id: 'sbx-1007', title: 'Data Engineer', company: 'Northbridge Payments', location: 'Bengaluru, India', city: 'Bengaluru', country: 'India', workMode: 'HYBRID', employmentType: 'FULL_TIME', primarySkill: 'Python', salary: { min: 2_800_000, max: 4_000_000, currency: 'INR', period: 'YEAR' }, postedDaysAgo: 6,
    description: d(`<p>Streaming data platform.</p><h3>Requirements</h3><ul><li>4-7 years</li><li>Python, Apache Spark, Kafka, SQL</li></ul>`) },
  { id: 'sbx-1008', title: 'Frontend Engineer', company: 'Pixelforge', location: 'Mumbai, India', city: 'Mumbai', country: 'India', workMode: 'ONSITE', employmentType: 'FULL_TIME', primarySkill: 'React', salary: null, postedDaysAgo: 12,
    description: d(`<p>Design systems and web performance.</p><h3>Requirements</h3><ul><li>3+ years</li><li>React, TypeScript, CSS</li></ul>`) },
  { id: 'sbx-1009', title: 'Backend Engineer (Python) - Protected', company: 'Fortress Bank', location: 'Bengaluru, India', city: 'Bengaluru', country: 'India', workMode: 'HYBRID', employmentType: 'FULL_TIME', primarySkill: 'Python', salary: { min: 3_200_000, max: 4_200_000, currency: 'INR', period: 'YEAR' }, postedDaysAgo: 2, captcha: true,
    description: d(`<p>Core banking APIs. This posting is protected by a CAPTCHA.</p><h3>Requirements</h3><ul><li>5+ years</li><li>Python, PostgreSQL, AWS</li></ul>`) },
  { id: 'sbx-1010', title: 'Software Engineering Intern', company: 'Brightlane Studio', location: 'Remote', city: null, country: 'India', workMode: 'REMOTE', employmentType: 'INTERNSHIP', primarySkill: 'Python', salary: { min: 30_000, max: 40_000, currency: 'INR', period: 'MONTH' }, postedDaysAgo: 2,
    description: d(`<p>Summer internship.</p><h3>Requirements</h3><ul><li>Fresher</li><li>Python or JavaScript</li></ul>`) },
  { id: 'sbx-1011', title: 'Senior Software Engineer - Billing', company: 'Ledgerly', location: 'Bengaluru, India', city: 'Bengaluru', country: 'India', workMode: 'REMOTE', employmentType: 'FULL_TIME', primarySkill: 'TypeScript', salary: { min: 3_500_000, max: 5_000_000, currency: 'INR', period: 'YEAR' }, postedDaysAgo: 1,
    description: d(`<p>Subscription billing engine.</p><h3>Requirements</h3><ul><li>6+ years</li><li>TypeScript, Node.js, PostgreSQL, AWS</li></ul><h3>Nice to have</h3><ul><li>Redis</li></ul>`) },
  { id: 'sbx-1012', title: 'Machine Learning Engineer', company: 'Quanta Analytics', location: 'Hyderabad, India', city: 'Hyderabad', country: 'India', workMode: 'HYBRID', employmentType: 'FULL_TIME', primarySkill: 'PyTorch', salary: null, postedDaysAgo: 20,
    description: d(`<p>Forecasting models.</p><h3>Requirements</h3><ul><li>3+ years</li><li>Python, PyTorch, Machine Learning</li></ul>`) },
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · Sandbox Job Board</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1f2937}label{display:block;margin:.8rem 0 .25rem;font-weight:600}
input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],select,textarea{width:100%;padding:.5rem;border:1px solid #cbd5e1;border-radius:6px}
fieldset{border:1px solid #e5e7eb;border-radius:6px;margin-top:.8rem}.error{color:#b91c1c;background:#fef2f2;padding:.75rem;border-radius:6px}
#confirmation{background:#ecfdf5;color:#065f46;padding:1rem;border-radius:6px}.banner{background:#fff7ed;padding:.5rem 1rem;border-radius:6px;font-size:.85rem}</style></head>
<body><p class="banner">Sandbox Job Board — test environment. Applications here are not sent to any employer.</p>${body}</body></html>`;
}

function jobView(base: string, j: SandboxJob) {
  return {
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    city: j.city,
    country: j.country,
    workMode: j.workMode,
    employmentType: j.employmentType,
    description: j.description,
    salary: j.salary,
    postedAt: new Date(Date.now() - j.postedDaysAgo * 86_400_000).toISOString(),
    url: `${base}/jobs/${j.id}`,
    applyUrl: `${base}/jobs/${j.id}/apply`,
  };
}

function applyForm(j: SandboxJob, error?: string, values: Record<string, string> = {}): string {
  const v = (k: string) => esc(values[k] ?? '');
  const captcha = j.captcha
    ? `<div class="g-recaptcha" id="captcha" data-captcha="required"><p>Please verify you are human.</p><input type="hidden" name="captcha_token" value=""></div>`
    : '';
  return page(
    `Apply: ${j.title}`,
    `<h1>Apply for ${esc(j.title)}</h1><p>${esc(j.company)} · ${esc(j.location)}</p>
${error ? `<div class="error" role="alert">${esc(error)}</div>` : ''}
<form id="application-form" method="post" enctype="multipart/form-data" action="/jobs/${j.id}/apply">
<label for="first_name">First name *</label><input type="text" id="first_name" name="first_name" required value="${v('first_name')}">
<label for="last_name">Last name *</label><input type="text" id="last_name" name="last_name" required value="${v('last_name')}">
<label for="email">Email *</label><input type="email" id="email" name="email" required value="${v('email')}">
<label for="phone">Phone *</label><input type="tel" id="phone" name="phone" required value="${v('phone')}">
<label for="location">Current location</label><input type="text" id="location" name="location" value="${v('location')}">
<label for="resume">Resume/CV *</label><input type="file" id="resume" name="resume" accept=".pdf,.docx" required>
<label for="linkedin">LinkedIn profile</label><input type="url" id="linkedin" name="linkedin" value="${v('linkedin')}">
<label for="years_experience">Total years of experience *</label><input type="number" id="years_experience" name="years_experience" min="0" max="60" required value="${v('years_experience')}">
<label for="skill_years">How many years of experience do you have with ${esc(j.primarySkill)}? *</label><input type="number" id="skill_years" name="skill_years" min="0" max="60" required value="${v('skill_years')}">
<label for="notice_period">Notice period *</label><select id="notice_period" name="notice_period" required>
<option value="">Select…</option><option value="0">Immediate</option><option value="15">15 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select>
<label for="expected_salary">Expected salary (annual, ${esc(j.salary?.currency ?? 'INR')}) *</label><input type="text" id="expected_salary" name="expected_salary" required value="${v('expected_salary')}">
<fieldset><legend>Are you legally authorized to work in ${esc(j.country)}? *</legend>
<label><input type="radio" name="work_authorization" value="yes" required> Yes</label><label><input type="radio" name="work_authorization" value="no"> No</label></fieldset>
<fieldset><legend>Will you now or in the future require visa sponsorship? *</legend>
<label><input type="radio" name="sponsorship" value="yes" required> Yes</label><label><input type="radio" name="sponsorship" value="no"> No</label></fieldset>
<label for="why_us">Why do you want to work at ${esc(j.company)}? *</label><textarea id="why_us" name="why_us" rows="5" maxlength="1500" required>${v('why_us')}</textarea>
<label for="cover_letter">Cover letter (optional)</label><textarea id="cover_letter" name="cover_letter" rows="6" maxlength="4000">${v('cover_letter')}</textarea>
<label for="gender">Gender (voluntary self-identification)</label><select id="gender" name="gender"><option value="">Select…</option><option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Non-binary</option><option value="decline">Decline to self-identify</option></select>
<label><input type="checkbox" id="certify" name="certify" value="yes" required> I certify that the information provided is true and complete *</label>
${captcha}
<p><button type="submit">Submit application</button></p>
</form>`,
  );
}

const REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'years_experience', 'skill_years', 'notice_period', 'expected_salary', 'work_authorization', 'sponsorship', 'why_us', 'certify'];

export interface SandboxServer {
  server: http.Server;
  url: string;
  applications: Map<string, SandboxApplication>;
  close(): Promise<void>;
}

export function createSandboxServer(opts: { publicUrl?: string } = {}): http.Server & { state: { applications: Map<string, SandboxApplication> } } {
  const applications = new Map<string, SandboxApplication>();
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host ?? 'localhost';
    const base = (opts.publicUrl ?? `http://${host}`).replace(/\/$/, '');
    const url = new URL(req.url ?? '/', base);
    const send = (status: number, body: string, type = 'text/html; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' });
      res.end(body);
    };
    const json = (status: number, body: unknown) => send(status, JSON.stringify(body), 'application/json');
    try {
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/api/health') return json(200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/jobs') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
        const loc = (url.searchParams.get('location') ?? '').toLowerCase();
        const days = Number(url.searchParams.get('days') ?? 0);
        const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 50));
        const syn = (w: string) => (w === 'developer' ? ['developer', 'engineer'] : w === 'engineer' ? ['engineer', 'developer'] : w === 'backend' ? ['backend', 'back end'] : [w]);
        const jobs = SANDBOX_JOBS.filter((j) => {
          const hay = `${j.title} ${j.description}`.toLowerCase();
          const titleL = j.title.toLowerCase();
          const kwOk = !q.length || (q.every((w) => syn(w).some((s) => hay.includes(s))) && q.some((w) => syn(w).some((s) => titleL.includes(s))));
          const locOk = !loc || j.workMode === 'REMOTE' || j.location.toLowerCase().includes(loc);
          const ageOk = !days || j.postedDaysAgo <= days;
          return kwOk && locOk && ageOk;
        })
          .slice(0, limit)
          .map((j) => jobView(base, j));
        return json(200, { jobs, total: jobs.length });
      }
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'jobs' && parts[2]) {
        const j = SANDBOX_JOBS.find((x) => x.id === parts[2]);
        return j ? json(200, jobView(base, j)) : json(404, { error: 'not found' });
      }
      if (parts[0] === 'api' && parts[1] === 'applications') {
        if (req.method === 'GET' && !parts[2]) return json(200, [...applications.values()].map(({ fields: _f, ...a }) => a));
        const a = parts[2] ? applications.get(parts[2]) : undefined;
        if (!a) return json(404, { error: 'not found' });
        if (req.method === 'GET') return json(200, { ref: a.ref, jobId: a.jobId, status: a.status, receivedAt: a.receivedAt });
        if (req.method === 'POST' && parts[3] === 'status') {
          const body = await readBody(req);
          const status = JSON.parse(body || '{}').status;
          if (!['RECEIVED', 'REVIEWING', 'INTERVIEW', 'REJECTED', 'OFFER'].includes(status)) return json(400, { error: 'bad status' });
          a.status = status;
          return json(200, { ref: a.ref, status });
        }
      }
      if (req.method === 'GET' && url.pathname === '/') {
        return send(200, page('Jobs', `<h1>Open roles</h1><ul>${SANDBOX_JOBS.map((j) => `<li><a href="/jobs/${j.id}">${esc(j.title)}</a> — ${esc(j.company)}, ${esc(j.location)}</li>`).join('')}</ul>`));
      }
      if (parts[0] === 'jobs' && parts[1]) {
        const j = SANDBOX_JOBS.find((x) => x.id === parts[1]);
        if (!j) return send(404, page('Not found', '<h1>Job not found</h1>'));
        if (req.method === 'GET' && !parts[2]) {
          const v = jobView(base, j);
          const ld = {
            '@context': 'https://schema.org/',
            '@type': 'JobPosting',
            title: j.title,
            description: j.description,
            identifier: { '@type': 'PropertyValue', name: j.company, value: j.id },
            datePosted: v.postedAt.slice(0, 10),
            employmentType: j.employmentType,
            hiringOrganization: { '@type': 'Organization', name: j.company },
            jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: j.city ?? undefined, addressCountry: j.country } },
            ...(j.workMode === 'REMOTE' ? { jobLocationType: 'TELECOMMUTE' } : {}),
            ...(j.salary ? { baseSalary: { '@type': 'MonetaryAmount', currency: j.salary.currency, value: { '@type': 'QuantitativeValue', minValue: j.salary.min, maxValue: j.salary.max, unitText: j.salary.period } } } : {}),
          };
          return send(200, page(j.title, `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script><h1>${esc(j.title)}</h1><p><strong>${esc(j.company)}</strong> · ${esc(j.location)} · ${j.workMode}</p><div class="description">${j.description}</div><p><a href="/jobs/${j.id}/apply">Apply now</a></p>`));
        }
        if (parts[2] === 'apply' && req.method === 'GET') return send(200, applyForm(j));
        if (parts[2] === 'apply' && req.method === 'POST') {
          const { fields, file } = await parseMultipart(req);
          if (j.captcha && !fields.captcha_token) return send(400, applyForm(j, 'CAPTCHA verification failed. Please complete the CAPTCHA.', fields));
          const missing = REQUIRED.filter((k) => !fields[k]?.trim());
          if (missing.length) return send(422, applyForm(j, `Please complete required fields: ${missing.join(', ')}`, fields));
          if (!file || file.bytes < 100) return send(422, applyForm(j, 'Please attach your resume (PDF or DOCX).', fields));
          if (!/\S+@\S+\.\S+/.test(fields.email!)) return send(422, applyForm(j, 'Please enter a valid email address.', fields));
          const dup = [...applications.values()].find((a) => a.jobId === j.id && a.fields.email === fields.email);
          if (dup) return send(409, applyForm(j, `You have already applied to this job (reference ${dup.ref}).`, fields));
          const ref = `SBX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          applications.set(ref, { ref, jobId: j.id, status: 'RECEIVED', receivedAt: new Date().toISOString(), fields, resume: file });
          return send(200, page('Application received', `<div id="confirmation" role="status"><h1>Thank you!</h1><p>Application submitted. Reference: ${ref}</p><p>${esc(j.company)} will review your application for ${esc(j.title)}.</p></div>`));
        }
      }
      send(404, page('Not found', '<h1>Not found</h1>'));
    } catch (e: any) {
      json(500, { error: e?.message ?? 'error' });
    }
  });
  return Object.assign(server, { state: { applications } });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 1e6) reject(new Error('too large'));
    });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

function parseMultipart(req: http.IncomingMessage): Promise<{ fields: Record<string, string>; file: SandboxApplication['resume'] }> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let file: SandboxApplication['resume'] = null;
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 50 } });
    } catch (e) {
      return reject(e);
    }
    bb.on('field', (name, val) => (fields[name] = String(val).slice(0, 10_000)));
    bb.on('file', (_name, stream, info) => {
      let bytes = 0;
      stream.on('data', (c: Buffer) => (bytes += c.length));
      stream.on('end', () => {
        if (info.filename) file = { fileName: info.filename, bytes, mimeType: info.mimeType };
      });
    });
    bb.on('close', () => resolve({ fields, file }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}
