import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserFormDriver, FillResult, FormFillValue, SubmissionResult } from '@autoapply/platform-integrations';
import { createLogger, type Logger } from '@autoapply/services';
import { detectedFieldSchema, type DetectedField } from '@autoapply/shared';

export class CaptchaRequiredError extends Error {
  constructor() {
    super('This application is protected by a CAPTCHA. Automated submission stopped — please complete it yourself.');
    this.name = 'CaptchaRequiredError';
  }
}

/** Counting semaphore for browser concurrency control. */
class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private available: number) {}
  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    return new Promise((resolve) => this.queue.push(() => resolve(() => this.release())));
  }
  private release() {
    const next = this.queue.shift();
    if (next) next();
    else this.available++;
  }
}

const CAPTCHA_SELECTORS = ['[data-captcha]', '.g-recaptcha', 'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', '.h-captcha', 'iframe[src*="challenges.cloudflare.com"]', '#captcha'];

export interface PlaywrightDriverOptions {
  maxConcurrency?: number;
  navigationTimeoutMs?: number;
  actionTimeoutMs?: number;
  headless?: boolean;
  executablePath?: string;
  /** Hosts automation may visit (defense in depth). Empty = any host allowed by adapters. */
  allowedHosts?: string[];
  logger?: Logger;
}

/**
 * Playwright implementation of BrowserFormDriver.
 *  - one shared browser process, an isolated BrowserContext per operation
 *    (no cookie/storage bleed between users);
 *  - concurrency limited by a semaphore; timeouts on every navigation/action;
 *  - crash recovery (relaunch on disconnect) and guaranteed context cleanup;
 *  - stops on CAPTCHA/anti-bot challenges — never attempts to bypass them.
 */
export class PlaywrightFormDriver implements BrowserFormDriver {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly sem: Semaphore;
  private readonly logger: Logger;

  constructor(private readonly opts: PlaywrightDriverOptions = {}) {
    this.sem = new Semaphore(opts.maxConcurrency ?? Number(process.env.BROWSER_MAX_CONCURRENCY ?? 2));
    this.logger = opts.logger ?? createLogger('browser');
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium
        .launch({ headless: this.opts.headless ?? true, executablePath: this.opts.executablePath ?? process.env.CHROMIUM_PATH ?? undefined, args: ['--disable-dev-shm-usage'] })
        .then((b) => {
          b.on('disconnected', () => {
            this.logger.warn('browser disconnected; will relaunch on next use');
            this.browser = null;
          });
          this.browser = b;
          return b;
        })
        .finally(() => (this.launching = null));
    }
    return this.launching;
  }

  private checkHost(url: string) {
    const allowed = this.opts.allowedHosts ?? (process.env.BROWSER_ALLOWED_HOSTS ? process.env.BROWSER_ALLOWED_HOSTS.split(',').map((h) => h.trim()) : []);
    if (!allowed.length) return;
    const host = new URL(url).hostname;
    if (!allowed.some((h) => host === h || host.endsWith(`.${h}`))) throw new Error(`Browser automation is not permitted for host ${host}`);
  }

  private async withPage<T>(url: string, storageState: unknown, fn: (page: Page, ctx: BrowserContext) => Promise<T>): Promise<T> {
    this.checkHost(url);
    const release = await this.sem.acquire();
    let context: BrowserContext | null = null;
    const started = Date.now();
    try {
      const browser = await this.getBrowser();
      context = await browser.newContext({ storageState: (storageState as any) ?? undefined, userAgent: 'AutoApplyBot/0.1 (+controlled automation)', acceptDownloads: false });
      context.setDefaultNavigationTimeout(this.opts.navigationTimeoutMs ?? 30_000);
      context.setDefaultTimeout(this.opts.actionTimeoutMs ?? 10_000);
      const page = await context.newPage();
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) throw lastErr;
      return await fn(page, context);
    } finally {
      await context?.close().catch(() => undefined);
      release();
      this.logger.info('browser operation finished', { host: new URL(url).host, ms: Date.now() - started });
    }
  }

  private async assertNoCaptcha(page: Page) {
    for (const sel of CAPTCHA_SELECTORS) {
      if ((await page.locator(sel).count()) > 0) throw new CaptchaRequiredError();
    }
  }

  async detectForm(url: string, opts: { formSelector?: string; storageState?: unknown } = {}): Promise<DetectedField[]> {
    return this.withPage(url, opts.storageState, async (page) => {
      const formSel = opts.formSelector ?? 'form';
      await page.waitForSelector(formSel);
      const raw = await page.$eval(formSel, extractFieldsInPage);
      const fields: DetectedField[] = [];
      for (const f of raw) {
        const p = detectedFieldSchema.safeParse(f);
        if (p.success) fields.push(p.data);
      }
      const captcha = await Promise.all(CAPTCHA_SELECTORS.map((s) => page.locator(s).count()));
      if (captcha.some((n) => n > 0)) {
        fields.push({ key: '__captcha__', label: 'CAPTCHA verification (must be completed by you)', type: 'CHECKBOX', required: true, options: [] });
      }
      return fields;
    });
  }

  private async fillValues(page: Page, formSel: string, values: FormFillValue[]): Promise<FillResult> {
    const filled: string[] = [];
    const skipped: FillResult['skipped'] = [];
    const form = page.locator(formSel).first();
    for (const v of values) {
      if (v.key === '__captcha__') {
        skipped.push({ key: v.key, reason: 'CAPTCHA must be completed by the user' });
        continue;
      }
      const el = form.locator(`[name="${cssEscape(v.key)}"]`);
      const n = await el.count();
      if (!n) {
        skipped.push({ key: v.key, reason: 'field not found' });
        continue;
      }
      const first = el.first();
      const tag = await first.evaluate((e) => e.tagName.toLowerCase());
      const type = ((await first.getAttribute('type')) ?? '').toLowerCase();
      try {
        if (type === 'file') {
          if (!v.filePath) {
            skipped.push({ key: v.key, reason: 'no file provided' });
            continue;
          }
          await first.setInputFiles(v.filePath);
        } else if (type === 'radio') {
          const val = String(v.value ?? '');
          if (!val) {
            skipped.push({ key: v.key, reason: 'empty value' });
            continue;
          }
          await form.locator(`input[name="${cssEscape(v.key)}"][value="${cssEscape(val)}"]`).check();
        } else if (type === 'checkbox') {
          await first.setChecked(v.value === true || v.value === 'true' || v.value === 'yes');
        } else if (tag === 'select') {
          if (v.value == null || v.value === '') {
            skipped.push({ key: v.key, reason: 'empty value' });
            continue;
          }
          await first.selectOption(Array.isArray(v.value) ? v.value : String(v.value));
        } else {
          if (v.value == null || v.value === '') {
            skipped.push({ key: v.key, reason: 'empty value' });
            continue;
          }
          await first.fill(String(v.value));
        }
        filled.push(v.key);
      } catch (e: any) {
        skipped.push({ key: v.key, reason: e?.message?.split('\n')[0] ?? 'fill failed' });
      }
    }
    return { filled, skipped };
  }

  async fillForm(url: string, values: FormFillValue[], opts: { formSelector?: string; storageState?: unknown; screenshot?: boolean } = {}): Promise<FillResult> {
    return this.withPage(url, opts.storageState, async (page) => {
      const formSel = opts.formSelector ?? 'form';
      await page.waitForSelector(formSel);
      const r = await this.fillValues(page, formSel, values);
      if (opts.screenshot) {
        r.screenshotPath = path.join(os.tmpdir(), `autoapply-fill-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        await page.screenshot({ path: r.screenshotPath, fullPage: true });
      }
      return r;
    });
  }

  async fillAndSubmit(
    url: string,
    values: FormFillValue[],
    opts: { formSelector?: string; submitSelector?: string; confirmation: { selector?: string; textPattern: string; referencePattern?: string }; storageState?: unknown; screenshot?: boolean },
  ): Promise<SubmissionResult> {
    try {
      return await this.withPage(url, opts.storageState, async (page) => {
        const formSel = opts.formSelector ?? 'form';
        await page.waitForSelector(formSel);
        await this.assertNoCaptcha(page);
        const fill = await this.fillValues(page, formSel, values);
        const requiredSkipped = [];
        for (const s of fill.skipped) {
          const req = await page.locator(`${formSel} [name="${cssEscape(s.key)}"][required]`).count();
          if (req) requiredSkipped.push(s);
        }
        if (requiredSkipped.length) {
          return { submitted: false, verified: false, error: `Required fields could not be filled: ${requiredSkipped.map((s) => `${s.key} (${s.reason})`).join(', ')}` };
        }
        // Native constraint validation would silently block the submit — report it instead.
        const invalid = await page.$eval(formSel, (f) => {
          const form = f as HTMLFormElement;
          if (form.checkValidity()) return [] as string[];
          return Array.from(form.elements)
            .filter((e) => !(e as HTMLInputElement).validity?.valid)
            .map((e) => `${(e as HTMLInputElement).name}: ${(e as HTMLInputElement).validationMessage}`);
        });
        if (invalid.length) return { submitted: false, verified: false, error: `The form rejected some values: ${invalid.join('; ').slice(0, 400)}` };
        const submit = page.locator(opts.submitSelector ?? `${formSel} [type=submit]`).first();
        await Promise.all([page.waitForLoadState('domcontentloaded'), submit.click()]);
        await page.waitForLoadState('load').catch(() => undefined);

        const shot = opts.screenshot ? path.join(os.tmpdir(), `autoapply-submit-${Date.now()}-${Math.random().toString(36).slice(2)}.png`) : undefined;
        const confirmLocator = opts.confirmation.selector ? page.locator(opts.confirmation.selector) : page.locator('body');
        const re = new RegExp(opts.confirmation.textPattern, 'i');
        let confirmationText: string | undefined;
        try {
          await confirmLocator.first().waitFor({ state: 'visible', timeout: 10_000 });
          const text = (await confirmLocator.first().innerText()).trim();
          if (re.test(text)) confirmationText = text;
        } catch {
          /* no confirmation element */
        }
        if (shot) await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
        if (confirmationText) {
          const ref = opts.confirmation.referencePattern ? new RegExp(opts.confirmation.referencePattern).exec(confirmationText)?.[1] : undefined;
          return { submitted: true, verified: true, confirmationText, confirmationUrl: page.url(), externalApplicationId: ref, screenshotPath: shot };
        }
        // Validation error shown → not submitted.
        const errorText = await page
          .locator('[role=alert], .error, .errors, .field-error')
          .first()
          .innerText({ timeout: 1000 })
          .catch(() => null);
        if (errorText) return { submitted: false, verified: false, error: `The form reported: ${errorText.trim().slice(0, 300)}`, screenshotPath: shot };
        await this.assertNoCaptcha(page);
        return { submitted: true, verified: false, confirmationUrl: page.url(), screenshotPath: shot };
      });
    } catch (e: any) {
      if (e instanceof CaptchaRequiredError) return { submitted: false, verified: false, error: e.message };
      throw e;
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/**
 * Runs inside the page: enumerates form controls and resolves human labels
 * (label[for], wrapping label, aria-label(ledby), fieldset legend, placeholder).
 */
function extractFieldsInPage(form: Element) {
  const out: any[] = [];
  const seen = new Set<string>();
  const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').replace(/\*\s*$/, '').trim();
  const labelFor = (el: HTMLElement): string => {
    const id = el.getAttribute('id');
    if (id) {
      const l = form.ownerDocument.querySelector(`label[for="${id}"]`);
      if (l) return text(l);
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(' ').map((i) => text(form.ownerDocument.getElementById(i))).join(' ');
    const wrap = el.closest('label');
    if (wrap) return text(wrap);
    return el.getAttribute('placeholder') ?? el.getAttribute('name') ?? '';
  };
  const controls = Array.from(form.querySelectorAll('input, select, textarea')) as HTMLInputElement[];
  for (const el of controls) {
    const name = el.getAttribute('name') ?? el.id;
    if (!name) continue;
    const type = (el.getAttribute('type') ?? el.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    if (seen.has(name)) continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    seen.add(name);
    if (type === 'radio') {
      const group = Array.from(form.querySelectorAll(`input[type=radio][name="${name}"]`)) as HTMLInputElement[];
      const legend = el.closest('fieldset')?.querySelector('legend');
      const options = group.map((r) => ({ value: r.value, label: text(r.closest('label')) || r.value }));
      const yn = options.length === 2 && options.every((o) => /^(yes|no)$/i.test(o.label));
      out.push({ key: name, label: legend ? text(legend) : labelFor(el), type: yn ? 'YES_NO' : 'MULTIPLE_CHOICE', required: group.some((r) => r.required), options });
      continue;
    }
    if (el.tagName === 'SELECT') {
      const sel = el as unknown as HTMLSelectElement;
      out.push({ key: name, label: labelFor(el), type: 'DROPDOWN', required: sel.required, options: Array.from(sel.options).filter((o) => o.value !== '').map((o) => ({ value: o.value, label: o.text.trim() })) });
      continue;
    }
    const map: Record<string, string> = { text: 'TEXT', email: 'EMAIL', tel: 'PHONE', url: 'URL', number: 'NUMBER', date: 'DATE', file: 'FILE', checkbox: 'CHECKBOX', textarea: 'TEXTAREA', search: 'TEXT', password: 'TEXT' };
    const ml = el.getAttribute('maxlength');
    out.push({ key: name, label: labelFor(el), type: map[type] ?? 'TEXT', required: el.required, options: [], maxLength: ml ? Number(ml) : null, placeholder: el.getAttribute('placeholder') });
  }
  return out;
}
