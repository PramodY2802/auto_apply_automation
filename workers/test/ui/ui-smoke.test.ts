/**
 * Browser E2E of the web UI against a running stack (web + API + workers + sandbox board).
 * Run: WEB_URL=http://localhost:3000 npx vitest run test/ui
 * Skipped automatically when WEB_URL is not set.
 */
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WEB = process.env.WEB_URL;
const SHOTS = process.env.UI_SCREENSHOTS;
const FIXTURE = path.resolve(__dirname, '../../../packages/document-extraction/src/__fixtures__/resume.pdf');
const email = `ui-${Date.now()}@example.com`;

describe.skipIf(!WEB)('web UI smoke', () => {
  let browser: Browser;
  let page: Page;
  const shot = async (name: string) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  });
  afterAll(async () => browser?.close());

  it('signs up and completes onboarding', async () => {
    await page.goto(`${WEB}/signup`);
    await shot('01-signup');
    await page.getByLabel('Full name').fill('Arjun Mehta');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Correct-horse-9');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/onboarding');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await page.getByText('SUCCEEDED', { exact: false }).or(page.getByText('Succeeded')).first().waitFor({ timeout: 60_000 });
    await shot('02-extraction');
    await page.getByRole('button', { name: 'Review extracted profile' }).click();
    expect(await page.getByLabel(/Full name/).inputValue()).toBe('Arjun Mehta');
    await shot('03-review');
    await page.getByText('I have reviewed these details').click();
    await page.getByRole('button', { name: 'Confirm & continue' }).click();
    await page.getByPlaceholder('Type a title and press Enter').fill('Backend Developer');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '+ Python Developer' }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Continue' }).click();
    await shot('04-preferences');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Save & find jobs' }).click();
    await page.waitForURL('**/jobs');
  });

  it('shows discovered jobs and job detail with match explanation', async () => {
    await page.getByRole('link', { name: 'Senior Backend Engineer (Python)' }).first().waitFor({ timeout: 60_000 });
    await shot('05-jobs');
    await page.getByRole('link', { name: 'Senior Backend Engineer (Python)' }).first().click();
    await page.getByText('not a prediction', { exact: false }).waitFor();
    await shot('06-job-detail');
    await page.getByRole('button', { name: 'Prepare application' }).click();
    await page.waitForURL('**/applications/**');
    await page.getByText('Questions & answers').waitFor();
    await page.getByText('Approve & submit').waitFor({ timeout: 60_000 });
    await shot('07-application-review');
  });

  it('dashboard renders real data', async () => {
    await page.goto(`${WEB}/dashboard`);
    await page.getByText('Jobs in feed').waitFor();
    await shot('08-dashboard');
    await page.goto(`${WEB}/platforms`);
    await page.getByText('LinkedIn').first().waitFor();
    await shot('09-platforms');
    await page.goto(`${WEB}/settings?tab=billing`);
    await page.getByText('Current plan:').first().waitFor();
    await shot('10-billing');
  });

  it('super admin panel', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${WEB}/login`);
    await p.getByLabel('Email').fill(process.env.UI_ADMIN_EMAIL ?? 'admin@autoapply.test');
    await p.getByLabel('Password').fill(process.env.UI_ADMIN_PASSWORD ?? 'Admin-pass-123');
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForURL('**/dashboard');
    await p.goto(`${WEB}/admin`);
    await p.getByText('Total users').waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, '11-admin.png'), fullPage: true });
    await p.goto(`${WEB}/admin?tab=system`);
    await p.getByRole('cell', { name: 'document-processing' }).waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, '12-admin-system.png'), fullPage: true });
    await ctx.close();
  });
});
