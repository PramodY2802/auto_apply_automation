'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AI_TASKS } from '@autoapply/shared';
import { get, post } from '@/lib/api';
import { ago, titleCase } from '@/lib/utils';
import { Alert, Badge, Button, Card, Checkbox, ConfirmButton, Field, Input, Select, Spinner, Table, useToast } from './ui';
import { del } from '@/lib/api';

/** Shared AI provider configuration panel for USER, ENTERPRISE and PLATFORM scopes. */
export function AiConfigPanel({ scope, title, description }: { scope: 'USER' | 'ENTERPRISE' | 'PLATFORM'; title: string; description?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: () => get<any[]>('/ai/providers') });
  const configs = useQuery({ queryKey: ['ai', 'configs', scope], queryFn: () => get<any[]>(`/ai/configs?scope=${scope}`) });
  const [form, setForm] = useState({ providerKey: 'openai', defaultModel: '', apiKey: '', monthlyTokenLimit: '', allowFallback: false, fallbackProviderKeys: [] as string[], taskModels: {} as Record<string, string> });
  const provider = providers.data?.find((p) => p.key === form.providerKey);
  const refresh = () => qc.invalidateQueries({ queryKey: ['ai'] });
  const save = useMutation({
    mutationFn: () => post('/ai/configs', { scope, providerKey: form.providerKey, defaultModel: form.defaultModel || provider?.models[0]?.id, apiKey: form.apiKey || undefined, monthlyTokenLimit: form.monthlyTokenLimit ? Number(form.monthlyTokenLimit) : null, allowFallback: form.allowFallback, fallbackProviderKeys: form.fallbackProviderKeys, taskModels: Object.fromEntries(Object.entries(form.taskModels).filter(([, v]) => v)) }),
    onSuccess: () => { toast({ tone: 'success', message: 'Provider saved. The key is encrypted and never shown again.' }); setForm((f) => ({ ...f, apiKey: '' })); void refresh(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const health = useMutation({ mutationFn: (id: string) => post<any>(`/ai/configs/${id}/health`), onSuccess: (r) => { toast({ tone: r.ok ? 'success' : 'error', message: r.ok ? `Healthy (${r.latencyMs}ms)` : `Unhealthy: ${r.error}` }); void refresh(); } });
  return (
    <Card title={title} description={description}>
      {configs.error && <Alert tone="error">{(configs.error as Error).message}</Alert>}
      {configs.isLoading ? <Spinner /> : configs.data && configs.data.length > 0 && (
        <Table head={['Provider', 'Default model', 'Key', 'Fallback', 'Health', '']} className="mb-6">
          {configs.data.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2 font-medium">{titleCase(c.providerKey)} {c.isActive && <Badge tone="green">Active</Badge>}</td>
              <td className="px-4 py-2 font-mono text-xs">{c.defaultModel}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{c.hasApiKey ? `••••${c.apiKeyLast4 ?? ''}` : 'none'}</td>
              <td className="px-4 py-2 text-xs">{c.allowFallback ? c.fallbackProviderKeys.join(', ') || 'none' : 'off'}</td>
              <td className="px-4 py-2 text-xs">{c.lastHealth ? <Badge tone={c.lastHealth.ok ? 'green' : 'red'}>{c.lastHealth.ok ? 'OK' : 'Error'} · {ago(c.lastHealth.at)}</Badge> : '—'}</td>
              <td className="px-4 py-2">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" loading={health.isPending} onClick={() => health.mutate(c.id)}>Test</Button>
                  {!c.isActive && <Button size="sm" variant="ghost" onClick={async () => { await post(`/ai/configs/${c.id}/activate`); void refresh(); }}>Make active</Button>}
                  <ConfirmButton size="sm" title="Remove provider?" message="The encrypted key is deleted." onConfirm={async () => { await del(`/ai/configs/${c.id}`); await refresh(); }}>Remove</ConfirmButton>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Provider">
          <Select value={form.providerKey} onChange={(e) => setForm({ ...form, providerKey: e.target.value, defaultModel: '' })}>
            {providers.data?.filter((p) => p.enabled).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Default model">
          <Select value={form.defaultModel || provider?.models[0]?.id || ''} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}>
            {provider?.models.map((m: any) => <option key={m.id} value={m.id}>{m.label} (${m.inputPer1M}/${m.outputPer1M} per 1M)</option>)}
          </Select>
        </Field>
        <Field label="API key" hint="Stored encrypted (AES-256-GCM). Leave empty to keep the existing key."><Input type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></Field>
        <Field label="Monthly token limit" hint="Optional cap for this configuration"><Input type="number" min={0} value={form.monthlyTokenLimit} onChange={(e) => setForm({ ...form, monthlyTokenLimit: e.target.value })} /></Field>
        <details className="md:col-span-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Per-task models & fallback</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {AI_TASKS.map((t) => (
              <Field key={t} label={titleCase(t)}>
                <Select value={form.taskModels[t] ?? ''} onChange={(e) => setForm({ ...form, taskModels: { ...form.taskModels, [t]: e.target.value } })}>
                  <option value="">Use default</option>
                  {provider?.models.map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </Select>
              </Field>
            ))}
            <div className="md:col-span-2">
              <Checkbox label="Allow fallback to another provider configured in this same scope" description="Never falls back to a different payer's credentials." checked={form.allowFallback} onChange={(v) => setForm({ ...form, allowFallback: v })} />
              {form.allowFallback && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {providers.data?.filter((p) => p.key !== form.providerKey).map((p) => <Checkbox key={p.key} label={p.name} checked={form.fallbackProviderKeys.includes(p.key)} onChange={(v) => setForm({ ...form, fallbackProviderKeys: v ? [...form.fallbackProviderKeys, p.key] : form.fallbackProviderKeys.filter((k) => k !== p.key) })} />)}
                </div>
              )}
            </div>
          </div>
        </details>
        <div className="md:col-span-2"><Button type="submit" loading={save.isPending}>Save provider</Button></div>
      </form>
    </Card>
  );
}

export function AiUsagePanel({ scope }: { scope: 'USER' | 'ENTERPRISE' | 'PLATFORM' }) {
  const q = useQuery({ queryKey: ['ai', 'usage', scope], queryFn: () => get<any>(`/ai/usage?scope=${scope}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert tone="error">{(q.error as Error).message}</Alert>;
  return (
    <Card title="AI usage (last 30 days)" description={`Total cost: $${q.data.totalCostUsd.toFixed(4)}`}>
      {q.data.byModel.length === 0 ? <p className="text-sm text-slate-500">No AI requests yet.</p> : (
        <Table head={['Provider', 'Model', 'Scope', 'Requests', 'Errors', 'Tokens', 'Cost']}>
          {q.data.byModel.map((r: any) => (
            <tr key={`${r.provider}${r.model}${r.scope}`}>
              <td className="px-4 py-2">{titleCase(r.provider)}</td><td className="px-4 py-2 font-mono text-xs">{r.model}</td><td className="px-4 py-2 text-xs">{titleCase(r.scope)}</td>
              <td className="px-4 py-2 tabular-nums">{r.requests}</td><td className="px-4 py-2 tabular-nums">{r.errors}</td>
              <td className="px-4 py-2 tabular-nums">{(r.inputTokens + r.outputTokens).toLocaleString()}</td><td className="px-4 py-2 tabular-nums">${r.costUsd.toFixed(4)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
