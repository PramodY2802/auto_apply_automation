/** Minimal cookie-aware API client that mimics the web app (session cookie + CSRF header). */
export class ApiClient {
  private cookies = new Map<string, string>();
  constructor(private readonly base: string, private readonly bearer?: string) {}

  csrf(): string | undefined {
    return this.cookies.get('aa_csrf');
  }

  async req<T = any>(method: string, path: string, body?: unknown, opts: { form?: FormData } = {}): Promise<{ status: number; body: T; headers: Headers }> {
    const headers: Record<string, string> = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET' && this.csrf()) headers['x-csrf-token'] = this.csrf()!;
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    let payload: any;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: payload });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv!.split('=');
      const val = v.join('=');
      if (/expires=Thu, 01 Jan 1970/i.test(c) || val === '') this.cookies.delete(k!.trim());
      else this.cookies.set(k!.trim(), val);
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* binary or text */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }
  get<T = any>(p: string) {
    return this.req<T>('GET', p);
  }
  post<T = any>(p: string, b?: unknown) {
    return this.req<T>('POST', p, b ?? {});
  }
  put<T = any>(p: string, b?: unknown) {
    return this.req<T>('PUT', p, b ?? {});
  }
  del<T = any>(p: string, b?: unknown) {
    return this.req<T>('DELETE', p, b);
  }
}

export async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, { timeoutMs = 60_000, intervalMs = 300, label = 'condition' } = {}): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(last)?.slice(0, 800)}`);
}
