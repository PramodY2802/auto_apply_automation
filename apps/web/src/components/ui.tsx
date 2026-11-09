'use client';

import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn, titleCase } from '@/lib/utils';

// ---------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-slate-900 text-white hover:bg-slate-800',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variants[variant],
        className,
      )}
      {...p}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

// ---------------------------------------------------------------- Form controls
const width = (c?: string) => (c && /(^|\s)(w-|min-w-|flex-1)/.test(c) ? '' : 'w-full');
const field = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, width(className), 'h-10', className)} {...p} />);
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, width(className), 'min-h-24', className)} {...p} />);
Textarea.displayName = 'Textarea';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(field, width(className), 'h-10', className)} {...p}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Field({ label, hint, error, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-rose-600" role="alert">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, description, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3', disabled && 'opacity-60')}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- Chips (multi-value text input)
export function ChipInput({ value, onChange, placeholder, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (s: string) => {
    const t = s.trim();
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div>
      <div className={cn(field, 'w-full flex min-h-10 flex-wrap items-center gap-1.5 py-1.5')}>
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-32 flex-1 bg-transparent text-sm outline-none"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600 hover:border-brand-500 hover:text-brand-700">
                + {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Layout
export function Card({ className, children, title, description, actions }: { className?: string; children?: ReactNode; title?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors', value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}
        >
          {t.label}
          {t.count !== undefined && <span className={cn('rounded-full px-1.5 text-xs', value === t.value ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Feedback
const badgeTone: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
};
export function Badge({ tone = 'slate', children, className }: { tone?: keyof typeof badgeTone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', badgeTone[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof badgeTone> = {
  APPLIED: 'green', OFFER: 'green', INTERVIEW: 'violet', REJECTED: 'red', FAILED: 'red', WITHDRAWN: 'slate', NEEDS_VERIFICATION: 'amber', UNKNOWN: 'amber',
  PENDING_APPROVAL: 'amber', IN_PROGRESS: 'blue', READY_TO_APPLY: 'brand', NOT_APPLIED: 'slate', DISCOVERED: 'slate',
  SUCCEEDED: 'green', PARTIAL: 'amber', RUNNING: 'blue', QUEUED: 'slate', CANCELED: 'slate', CONNECTED: 'green', DISCONNECTED: 'slate', PENDING_USER_ACTION: 'amber', ERROR: 'red', NEEDS_REAUTH: 'amber',
  IMPLEMENTED: 'green', USER_ASSISTED: 'amber', UNSUPPORTED: 'slate', AWAITING_CREDENTIALS: 'blue', MOCKED: 'violet',
  ACTIVE: 'green', TRIALING: 'blue', PAST_DUE: 'amber', SUSPENDED: 'red', PAID: 'green', OPEN: 'amber', VOID: 'slate', EXTRACTED: 'green', PROCESSING: 'blue', UPLOADED: 'slate',
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'slate'}>{titleCase(status)}</Badge>;
}

export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 80 ? '#059669' : score >= 65 ? '#4f46e5' : score >= 45 ? '#d97706' : '#94a3b8';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Match score ${score.toFixed(0)}/100 — fit with your profile, not a hiring probability`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#e2e8f0" strokeWidth="5" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="5" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-800">{Math.round(score)}</span>
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number | null; label: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span className="tabular-nums">
          {value.toLocaleString()} / {max == null ? '∞' : max.toLocaleString()}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className={cn('h-2 rounded-full', pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${max == null ? 4 : pct}%` }} />
      </div>
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: ReactNode; children?: ReactNode }) {
  const map = { info: ['border-sky-200 bg-sky-50 text-sky-900', Info], warn: ['border-amber-200 bg-amber-50 text-amber-900', AlertCircle], error: ['border-rose-200 bg-rose-50 text-rose-900', AlertCircle], success: ['border-emerald-200 bg-emerald-50 text-emerald-900', CheckCircle2] } as const;
  const [cls, Icon] = map[tone];
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3 text-sm', cls)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" /> {label ?? 'Loading…'}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

export function Empty({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Alert tone="error" title="Something went wrong">
      {(error as Error)?.message ?? 'Request failed'} {retry && <button className="ml-2 underline" onClick={retry}>Retry</button>}
    </Alert>
  );
}

// ---------------------------------------------------------------- Dialog
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className={cn('m-auto w-full rounded-xl border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40', wide ? 'max-w-2xl' : 'max-w-md')}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <button aria-label="Close" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
    </dialog>
  );
}

export function ConfirmButton({ onConfirm, children, title, message, variant = 'danger', size, confirmLabel = 'Confirm' }: { onConfirm: () => Promise<unknown> | void; children: ReactNode; title: string; message: ReactNode; variant?: Variant; size?: 'sm' | 'md'; confirmLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant === 'danger' ? 'outline' : variant} size={size} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={variant}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-sm text-slate-600">{message}</div>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- Table
export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-slate-200 bg-white', className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between py-3 text-sm text-slate-600">
      <span>
        {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Toasts
interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg', t.tone === 'success' ? 'border-emerald-200 bg-white text-emerald-800' : t.tone === 'error' ? 'border-rose-200 bg-white text-rose-800' : 'border-slate-200 bg-white text-slate-800')}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
