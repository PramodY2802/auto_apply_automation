/** Verifies the extension content script against the sandbox board in a real browser. */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandboxServer } from '@autoapply/sandbox-board';

const SCRIPT = fs.readFileSync(path.resolve(__dirname, '../../../extension/content.js'), 'utf8');
const STUB = `window.__handlers=[];window.chrome={runtime:{onMessage:{addListener:(h)=>window.__handlers.push(h)}}};window.__send=(m)=>new Promise(r=>window.__handlers[0](m,{},r));`;

describe('extension content script', () => {
  let browser: Browser;
  let page: Page;
  let base: string;
  const server = createSandboxServer();
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser?.close();
    server.close();
  });
  const inject = async () => {
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: SCRIPT });
  };

  it('extracts a JobPosting from JSON-LD', async () => {
    await page.goto(`${base}/jobs/sbx-1001`);
    await inject();
    const r: any = await page.evaluate(() => (window as any).__send({ type: 'EXTRACT_JOB' }));
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ title: 'Senior Backend Engineer (Python)', company: 'Northbridge Payments', externalId: 'sbx-1001', employmentType: 'FULL_TIME' });
    expect(r.data.description).toContain('PostgreSQL');
    expect(r.data.location).toContain('Bengaluru');
  });

  it('fills only approved values and never ticks consents or submits', async () => {
    await page.goto(`${base}/jobs/sbx-1001/apply`);
    await inject();
    const r: any = await page.evaluate(() =>
      (window as any).__send({
        type: 'FILL',
        fields: [
          { key: 'first_name', value: 'Arjun' },
          { key: 'notice_period', value: '30' },
          { key: 'work_authorization', value: 'yes' },
          { key: 'why_us', value: null, needsReview: true },
          { key: 'certify', value: 'true' },
          { key: 'resume', value: 'resume' },
        ],
      }),
    );
    expect(r.data.filled).toEqual(['first_name', 'notice_period', 'work_authorization']);
    expect(r.data.skipped.map((s: any) => s.key)).toEqual(['why_us', 'certify', 'resume']);
    expect(await page.inputValue('#first_name')).toBe('Arjun');
    expect(await page.inputValue('#notice_period')).toBe('30');
    expect(await page.isChecked('#certify')).toBe(false);
    expect(page.url()).toContain('/apply');
    expect(server.state.applications.size).toBe(0);
  });
});
