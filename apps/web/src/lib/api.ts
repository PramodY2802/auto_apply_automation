/** Same-origin API client (Next rewrites /api → NestJS). Sends the CSRF token on mutations. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: any) {
    super(message);
  }
}

function csrf(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie.split('; ').find((c) => c.startsWith('aa_csrf='))?.split('=')[1];
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const t = csrf();
    if (t) headers['x-csrf-token'] = t;
  }
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`/api/v1${path}`, { method, headers, body, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.issues?.length ? data.issues.map((i: any) => `${i.path ? `${i.path}: ` : ''}${i.message}`).join('; ') : (data?.message ?? res.statusText);
    throw new ApiError(res.status, data?.code ?? 'ERROR', msg, data);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'DELETE', body });
