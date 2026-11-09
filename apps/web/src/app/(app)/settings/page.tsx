'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AiConfigPanel, AiUsagePanel } from '@/components/ai-config';
import { useLogout, useMe } from '@/components/providers';
import { Alert, Badge, Button, Card, ConfirmButton, Field, Input, Meter, PageHeader, Spinner, StatusBadge, Table, Tabs, useToast } from '@/components/ui';
import { del, get, post, put } from '@/lib/api';
import { ago, cents, fmtDate, titleCase } from '@/lib/utils';

type Tab = 'account' | 'security' | 'ai' | 'billing' | 'extension' | 'privacy';

function Account() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me?.user.fullName ?? '');
  const save = useMutation({ mutationFn: () => put('/me', { fullName: name }), onSuccess: () => { toast({ tone: 'success', message: 'Saved' }); void qc.invalidateQueries({ queryKey: ['me'] }); } });
  const saved = useQuery({ queryKey: ['saved-answers'], queryFn: () => get<any[]>('/saved-answers') });
  return (
    <div className="space-y-6">
      <Card title="Account">
        <div className="grid max-w-xl gap-4">
          <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email"><Input value={me?.user.email ?? ''} disabled /></Field>
          <div><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
        </div>
      </Card>
      <Card title="Saved answers" description="Answers you approved for reuse across applications.">
        {saved.data?.length ? (
          <ul className="divide-y divide-slate-100">
            {saved.data.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                <div><div className="font-medium text-slate-800">{s.question}</div><div className="text-slate-600">{s.answer}</div></div>
                <ConfirmButton size="sm" title="Delete saved answer?" message="Future applications will no longer reuse it." onConfirm={async () => { await del(`/saved-answers/${s.id}`); await saved.refetch(); }}>Delete</ConfirmButton>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">None yet.</p>}
      </Card>
    </div>
  );
}

function Security() {
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get<any[]>('/me/sessions') });
  const change = useMutation({ mutationFn: () => post('/auth/password/change', pw), onSuccess: () => { toast({ tone: 'success', message: 'Password changed; other sessions signed out' }); setPw({ currentPassword: '', newPassword: '' }); void sessions.refetch(); }, onError: (e) => toast({ tone: 'error', message: (e as Error).message }) });
  return (
    <div className="space-y-6">
      <Card title="Change password">
        <form className="grid max-w-xl gap-4" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password" hint="At least 10 characters with a letter and a number"><Input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <div><Button type="submit" loading={change.isPending}>Update password</Button></div>
        </form>
      </Card>
      <Card title="Active sessions">
        {sessions.isLoading ? <Spinner /> : (
          <Table head={['Device', 'IP', 'Last active', '']}>
            {sessions.data?.map((s) => (
              <tr key={s.id}>
                <td className="max-w-xs truncate px-4 py-2 text-xs">{s.userAgent ?? 'Unknown'} {s.current && <Badge tone="green">This device</Badge>}</td>
                <td className="px-4 py-2 text-xs">{s.ip ?? '—'}</td>
                <td className="px-4 py-2 text-xs">{ago(s.lastSeenAt)}</td>
                <td className="px-4 py-2 text-right">{!s.current && <Button size="sm" variant="ghost" onClick={async () => { await del(`/me/sessions/${s.id}`); void sessions.refetch(); }}>Revoke</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function Billing() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const sub = useQuery({ queryKey: ['billing', 'subscription'], queryFn: () => get<any>('/billing/subscription') });
  const plans = useQuery({ queryKey: ['billing', 'plans'], queryFn: () => get<any[]>('/billing/plans') });
  const invoices = useQuery({ queryKey: ['billing', 'invoices'], queryFn: () => get<any[]>('/billing/invoices') });
  const [interval, setInterval] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const canManage = !me?.enterprise || me.permissions.includes('enterprise:billing:manage');
  const change = useMutation({
    mutationFn: (planKey: string) => post<any>('/billing/subscription', { planKey, interval }),
    onSuccess: (r) => { toast({ tone: 'success', message: r.effective === 'NOW' ? 'Plan updated' : 'Change scheduled for the end of the billing period' }); void qc.invalidateQueries(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  if (sub.isLoading) return <Spinner />;
  const s = sub.data;
  return (
    <div className="space-y-6">
      <Card title={<span className="flex items-center gap-2">Current plan: {s.plan?.name ?? 'Free'} {s.subscription && <StatusBadge status={s.subscription.status} />}</span>}
        description={s.subscription ? `${titleCase(s.subscription.interval)} · renews ${fmtDate(s.subscription.currentPeriodEnd)}${s.subscription.cancelAtPeriodEnd ? ' · cancels at period end' : ''}${s.pendingPlan ? ` · switching to ${s.pendingPlan.name}` : ''}` : undefined}
        actions={canManage && s.plan?.key !== 'free' && !s.subscription?.cancelAtPeriodEnd && <ConfirmButton size="sm" title="Cancel subscription?" message="You keep access until the end of the current period, then move to Free." onConfirm={async () => { await post('/billing/subscription/cancel'); await qc.invalidateQueries(); }}>Cancel plan</ConfirmButton>}>
        <div className="grid gap-4 md:grid-cols-2">{s.usage.map((u: any) => <Meter key={u.metric} label={titleCase(u.metric)} value={u.metric === 'STORAGE_BYTES' ? Math.round(u.used / 1048576) : u.used} max={u.limit == null ? null : u.metric === 'STORAGE_BYTES' ? Math.round(u.limit / 1048576) : u.limit} />)}</div>
        <p className="mt-3 text-xs text-slate-500">Period {s.period}. Payment provider: {s.paymentProvider.key} ({titleCase(s.paymentProvider.status)}). AI usage on platform-managed providers is invoiced separately from the subscription.</p>
      </Card>
      {canManage && (
        <Card title="Change plan" actions={<div className="flex rounded-lg bg-slate-100 p-1 text-xs">{(['MONTHLY', 'ANNUAL'] as const).map((i) => <button key={i} onClick={() => setInterval(i)} className={`rounded-md px-3 py-1 ${interval === i ? 'bg-white shadow-sm font-medium' : 'text-slate-500'}`}>{titleCase(i)}</button>)}</div>}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.data?.filter((p) => (me?.enterprise ? p.features.enterprise : !p.features.enterprise)).map((p) => (
              <div key={p.key} className={`rounded-xl border p-4 ${s.plan?.key === p.key ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="mt-1 text-2xl font-semibold">{cents(interval === 'ANNUAL' ? p.priceAnnualCents : p.priceMonthlyCents, p.currency)}<span className="text-xs font-normal text-slate-500">/{interval === 'ANNUAL' ? 'yr' : 'mo'}</span></div>
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  <li>{p.limits.applicationsPerMonth ?? '∞'} applications / mo</li>
                  <li>{p.limits.searchesPerMonth ?? '∞'} searches / mo</li>
                  <li>{(p.limits.aiTokensPerMonth ?? 0).toLocaleString()} AI tokens / mo</li>
                  <li>{p.features.autoApply ? '✓' : '✗'} Automatic applications</li>
                  <li>{p.features.byoAiKey ? '✓' : '✗'} Your own AI key</li>
                  <li>{p.features.scheduledSearch ? '✓' : '✗'} Scheduled search</li>
                </ul>
                <Button className="mt-4 w-full" size="sm" variant={s.plan?.key === p.key ? 'outline' : 'primary'} disabled={s.plan?.key === p.key && s.subscription?.interval === interval} loading={change.isPending && change.variables === p.key} onClick={() => change.mutate(p.key)}>
                  {s.plan?.key === p.key ? 'Current plan' : 'Switch'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Invoices">
        {invoices.data?.length ? (
          <Table head={['Number', 'Type', 'Period', 'Amount', 'Status']}>
            {invoices.data.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-2 font-mono text-xs">{i.number}</td><td className="px-4 py-2 text-xs">{titleCase(i.kind)}</td>
                <td className="px-4 py-2 text-xs">{new Date(i.periodStart).toLocaleDateString()} – {new Date(i.periodEnd).toLocaleDateString()}</td>
                <td className="px-4 py-2 tabular-nums">{cents(i.amountCents, i.currency)}</td><td className="px-4 py-2"><StatusBadge status={i.status} /></td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-slate-500">No invoices yet.</p>}
      </Card>
    </div>
  );
}

function Extension() {
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: () => get<any[]>('/me/api-tokens') });
  const [created, setCreated] = useState<string | null>(null);
  const toast = useToast();
  const create = useMutation({ mutationFn: () => post<any>('/me/api-tokens', { name: 'Browser extension' }), onSuccess: (r) => { setCreated(r.token); void tokens.refetch(); } });
  return (
    <Card title="Browser extension" description="The extension uses a personal token limited to extension endpoints (capture jobs, fill approved answers, report submissions). It never receives AI keys or platform credentials.">
      {created && (
        <Alert tone="success" title="Copy your token now — it won't be shown again">
          <div className="mt-2 flex items-center gap-2"><code className="break-all rounded bg-white px-2 py-1 text-xs">{created}</code><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(created); toast({ tone: 'success', message: 'Copied' }); }}><Copy className="h-3 w-3" /></Button></div>
        </Alert>
      )}
      <div className="my-4"><Button loading={create.isPending} onClick={() => create.mutate()}>Create extension token</Button></div>
      {tokens.data?.length ? (
        <Table head={['Name', 'Token', 'Last used', 'Expires', '']}>
          {tokens.data.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-2">{t.name}</td><td className="px-4 py-2 font-mono text-xs">{t.prefix}…</td><td className="px-4 py-2 text-xs">{ago(t.lastUsedAt)}</td><td className="px-4 py-2 text-xs">{fmtDate(t.expiresAt)}</td>
              <td className="px-4 py-2 text-right"><ConfirmButton size="sm" title="Revoke token?" message="The extension will be signed out." onConfirm={async () => { await del(`/me/api-tokens/${t.id}`); await tokens.refetch(); }}>Revoke</ConfirmButton></td>
            </tr>
          ))}
        </Table>
      ) : null}
    </Card>
  );
}

function Privacy() {
  const logout = useLogout();
  const [confirm, setConfirm] = useState('');
  const toast = useToast();
  return (
    <div className="space-y-6">
      <Card title="Export your data" description="Download your profile, preferences, applications and resume metadata as JSON.">
        <Button variant="outline" onClick={async () => { const data = await get('/me/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'autoapply-export.json'; a.click(); URL.revokeObjectURL(url); }}>Download export</Button>
      </Card>
      <Card title="Delete account" description="Permanently deletes your account, resumes (including stored files), profile, applications and AI keys.">
        <div className="flex max-w-md items-end gap-2">
          <Field label='Type "DELETE" to confirm' className="flex-1"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <Button variant="danger" disabled={confirm !== 'DELETE'} onClick={async () => { try { await del('/me', { confirm: 'DELETE' }); await logout(); } catch (e) { toast({ tone: 'error', message: (e as Error).message }); } }}>Delete account</Button>
        </div>
      </Card>
    </div>
  );
}

function SettingsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data: me } = useMe();
  const tab = (sp.get('tab') as Tab) ?? 'account';
  const tabs: { value: Tab; label: string }[] = [
    { value: 'account', label: 'Account' },
    { value: 'security', label: 'Security' },
    { value: 'ai', label: 'AI settings' },
    { value: 'billing', label: 'Billing & usage' },
    { value: 'extension', label: 'Extension' },
    { value: 'privacy', label: 'Privacy' },
  ];
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={tabs} value={tab} onChange={(v) => router.replace(`/settings?tab=${v}`)} />
      <div className="mt-6">
        {tab === 'account' && <Account />}
        {tab === 'security' && <Security />}
        {tab === 'ai' && (
          <div className="space-y-6">
            <EffectiveAi />
            {me?.plan.features.byoAiKey ? <AiConfigPanel scope="USER" title="Your own AI provider keys" description="Optional. Requests then run on your key and are billed by the provider directly." /> : <Alert tone="info">Your plan uses platform-managed AI. Upgrade to Basic or higher to use your own OpenAI, Anthropic or Gemini key.</Alert>}
            <AiUsagePanel scope="USER" />
          </div>
        )}
        {tab === 'billing' && <Billing />}
        {tab === 'extension' && <Extension />}
        {tab === 'privacy' && <Privacy />}
      </div>
    </>
  );
}

function EffectiveAi() {
  const q = useQuery({ queryKey: ['ai', 'effective'], queryFn: () => get<Record<string, any>>('/ai/effective') });
  return (
    <Card title="Which AI handles what" description="Resolved from your settings, your enterprise and the platform — never silently switched to another payer.">
      {q.data && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(q.data).map(([task, v]) => (
            <li key={task} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">{titleCase(task)}</span>
              {v ? <span className="font-medium">{titleCase(v.provider)} · <span className="font-mono text-xs">{v.model}</span> <Badge tone="slate">{titleCase(v.scope)}</Badge></span> : <span className="text-amber-700">Not configured</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
