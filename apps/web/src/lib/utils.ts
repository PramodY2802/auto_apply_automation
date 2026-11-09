import { clsx, type ClassValue } from 'clsx';
export const cn = (...v: ClassValue[]) => clsx(v);

export function money(min?: number | null, max?: number | null, currency?: string | null, period?: string | null) {
  if (min == null && max == null) return null;
  const f = (n: number) => (n >= 100000 && currency === 'INR' ? `${(n / 100000).toFixed(n % 100000 ? 1 : 0)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const range = min != null && max != null ? `${f(min)}–${f(max)}` : f((min ?? max)!);
  return `${currency ?? ''} ${range}${period && period !== 'YEAR' ? `/${period.toLowerCase()}` : ''}`.trim();
}

export function ago(d?: string | Date | null) {
  if (!d) return '—';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString();
}

export function fmtDate(d?: string | Date | null) {
  return d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const cents = (c: number, cur = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(c / 100);
