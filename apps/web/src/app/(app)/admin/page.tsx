'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { INTEGRATION_OPERATIONS } from '@autoapply/shared';
import { AiConfigPanel, AiUsagePanel } from '@/components/ai-config';
import { useCan, useMe } from '@/components/providers';
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, PageHeader, Select, Spinner, Stat, StatusBadge, Table, Tabs, Textarea, useToast } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { ago, cents, fmtDate, titleCase } from '@/lib/utils';

type Tab = 'overview' | 'users' | 'enterprises' | 'plans' | 'billing' | 'ai' | 'integrations' | 'system' | 'audit' | 'settings';

function Overview() {
  const q = useQuery({ queryKey: ['admin', 'metrics'], queryFn: () => get<any>('/admin/metrics'), refetchInterval: 30_000 });
  if (q.isLoading) return <Spinner />;
  const m = q.data;
  const paid = m.revenue?.invoices.filter((i: any) => i.status === 'PAID') ?? [];
  const sum = (k: string) => paid.filter((i: any) => i.kind === k).reduce((s: number, i: any) => s + i.cents, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total users" value={m.users.total} hint={`${m.users.active30d} active (30d)`} />
        <Stat label="Enterprises" value={m.enterprises} />
        <Stat label="Active subscriptions" value={m.activeSubscriptions} />
        <Stat label="Jobs discovered" value={m.jobsDiscovered.toLocaleString()} />
        <Stat label="Applications submitted" value={m.applications.submitted} hint={`${m.applications.needsVerification} need verification`} />
        <Stat label="Application failures" value={m.applications.failed} />
        {m.revenue && <Stat label="MRR" value={cents(m.revenue.mrrCents)} hint={`Collected: ${cents(sum('SUBSCRIPTION'))} subs · ${cents(sum('AI_USAGE'))} AI`} />}
        {m.ai && <Stat label="AI cost (30d)" value={`$${m.ai.last30Days.reduce((s: number, r: any) => s + r.costUsd, 0).toFixed(2)}`} hint={`${m.ai.last30Days.reduce((s: number, r: any) => s + r.requests, 0)} requests`} />}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {m.ai && (
          <Card title="AI provider usage (30d)">
            <div className="h-56"><ResponsiveContainer><BarChart data={m.ai.last30Days.map((r: any) => ({ name: `${r.provider} (${r.scope.toLowerCase()})`, requests: r.requests, errors: r.errors }))}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={32} /><Tooltip /><Bar dataKey="requests" fill="#4f46e5" /><Bar dataKey="errors" fill="#f43f5e" /></BarChart></ResponsiveContainer></div>
          </Card>
        )}
        <Card title="Discovery runs (30d)">
          <ul className="space-y-1 text-sm">{Object.entries(m.discoveryRuns30d).map(([k, v]) => <li key={k} className="flex justify-between"><StatusBadge status={k} /><span className="tabular-nums">{v as number}</span></li>)}</ul>
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase text-slate-500">Workers</h3>
          {m.workers.length ? <ul className="space-y-1 text-xs">{m.workers.map((w: any) => <li key={w.id} className="flex justify-between"><span className="font-mono">{w.id}</span><span>{ago(w.at)} · {w.rssMb}MB</span></li>)}</ul> : <Alert tone="warn">No worker heartbeats — background processing is stopped.</Alert>}
        </Card>
      </div>
    </div>
  );
}

function Users() {
  const can = useCan();
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => get<any>(`/admin/users?q=${encodeURIComponent(q)}`) });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: any }) => put(`/admin/users/${id}`, body), onSuccess: () => { toast({ tone: 'success', message: 'Updated' }); void list.refetch(); }, onError: (e) => toast({ tone: 'error', message: (e as Error).message }) });
  return (
    <Card title="Users">
      <Input className="mb-4 max-w-sm" placeholder="Search email or name" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.isLoading ? <Spinner /> : (
        <Table head={['User', 'Type', 'Enterprise', 'Role', 'Status', 'Last login', '']}>
          {list.data.items.map((u: any) => (
            <tr key={u.id}>
              <td className="px-4 py-2"><div className="font-medium">{u.fullName}</div><div className="text-xs text-slate-500">{u.email} {!u.emailVerifiedAt && <Badge tone="amber">unverified</Badge>}</div></td>
              <td className="px-4 py-2 text-xs">{titleCase(u.accountType)}</td>
              <td className="px-4 py-2 text-xs">{u.enterpriseName ?? '—'}</td>
              <td className="px-4 py-2">{can('admin:roles:manage') && u.id !== me?.user.id ? <Select className="h-8 w-40" value={u.platformRole} onChange={(e) => update.mutate({ id: u.id, body: { platformRole: e.target.value } })}><option value="USER">User</option><option value="PLATFORM_ADMIN">Platform admin</option><option value="SUPER_ADMIN">Super admin</option></Select> : <span className="text-xs">{titleCase(u.platformRole)}</span>}</td>
              <td className="px-4 py-2"><StatusBadge status={u.status} /></td>
              <td className="px-4 py-2 text-xs text-slate-500">{ago(u.lastLoginAt)}</td>
              <td className="px-4 py-2 text-right">{can('admin:users:manage') && u.id !== me?.user.id && <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, body: { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } })}>{u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</Button>}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Enterprises() {
  const can = useCan();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', 'enterprises'], queryFn: () => get<any[]>('/admin/enterprises') });
  const [f, setF] = useState({ name: '', adminEmail: '', planKey: 'enterprise' });
  const create = useMutation({ mutationFn: () => post('/admin/enterprises', f), onSuccess: () => { toast({ tone: 'success', message: 'Enterprise created' }); setF({ ...f, name: '', adminEmail: '' }); void list.refetch(); }, onError: (e) => toast({ tone: 'error', message: (e as Error).message }) });
  return (
    <div className="space-y-6">
      {can('admin:users:manage') && (
        <Card title="Create enterprise">
          <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Admin email"><Input type="email" required value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></Field>
            <Button type="submit" loading={create.isPending}>Create</Button>
          </form>
        </Card>
      )}
      <Card title="Enterprises">
        <Table head={['Name', 'Plan', 'Members', 'Status', 'Created', '']}>
          {list.data?.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-2 font-medium">{e.name}<div className="text-xs text-slate-500">{e.slug}</div></td>
              <td className="px-4 py-2 text-xs">{e.plan ?? '—'}</td><td className="px-4 py-2 tabular-nums">{e.members}</td><td className="px-4 py-2"><StatusBadge status={e.status} /></td><td className="px-4 py-2 text-xs">{fmtDate(e.createdAt)}</td>
              <td className="px-4 py-2 text-right">{can('admin:users:manage') && <Button size="sm" variant="ghost" onClick={async () => { await put(`/admin/enterprises/${e.id}`, { status: e.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }); void list.refetch(); }}>{e.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</Button>}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function Plans() {
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => get<any[]>('/admin/plans') });
  const [edit, setEdit] = useState<any>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: edit.name, priceMonthlyCents: Number(edit.priceMonthlyCents), priceAnnualCents: Number(edit.priceAnnualCents), currency: edit.currency, limits: JSON.parse(edit.limitsText), features: JSON.parse(edit.featuresText), aiMarkupPercent: Number(edit.aiMarkupPercent), isActive: edit.isActive, isCustom: edit.isCustom };
      return edit.isNew ? post('/admin/plans', { ...body, key: edit.key }) : put(`/admin/plans/${edit.key}`, body);
    },
    onSuccess: () => { toast({ tone: 'success', message: 'Plan saved' }); setEdit(null); void list.refetch(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const open = (p: any, isNew = false) => setEdit({ ...p, isNew, limitsText: JSON.stringify(p.limits, null, 2), featuresText: JSON.stringify(p.features, null, 2) });
  return (
    <Card title="Subscription plans" actions={<Button size="sm" onClick={() => open({ key: '', name: '', priceMonthlyCents: 0, priceAnnualCents: 0, currency: 'USD', aiMarkupPercent: 20, isActive: true, isCustom: true, limits: { users: 1, searchesPerMonth: 100, applicationsPerMonth: 50, aiTokensPerMonth: 500000, storageMb: 100, browserMinutesPerMonth: 100 }, features: { autoApply: false, byoAiKey: false, enterprise: false, extension: true, scheduledSearch: false } }, true)}>New plan</Button>}>
      <Table head={['Plan', 'Monthly', 'Annual', 'AI markup', 'Limits', 'Status', '']}>
        {list.data?.map((p) => (
          <tr key={p.key}>
            <td className="px-4 py-2 font-medium">{p.name} <span className="font-mono text-xs text-slate-400">{p.key}</span></td>
            <td className="px-4 py-2 tabular-nums">{cents(p.priceMonthlyCents, p.currency)}</td><td className="px-4 py-2 tabular-nums">{cents(p.priceAnnualCents, p.currency)}</td><td className="px-4 py-2">{p.aiMarkupPercent}%</td>
            <td className="px-4 py-2 text-xs text-slate-500">{p.limits.applicationsPerMonth ?? '∞'} apps · {p.limits.searchesPerMonth ?? '∞'} searches · {p.limits.users ?? '∞'} users</td>
            <td className="px-4 py-2">{p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>} {p.isCustom && <Badge tone="violet">Custom</Badge>}</td>
            <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => open(p)}>Edit</Button></td>
          </tr>
        ))}
      </Table>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? 'New plan' : `Edit ${edit?.name}`} wide footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
        {edit && (
          <div className="grid gap-3 md:grid-cols-2">
            {edit.isNew && <Field label="Key"><Input value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} /></Field>}
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Monthly price (cents)"><Input type="number" value={edit.priceMonthlyCents} onChange={(e) => setEdit({ ...edit, priceMonthlyCents: e.target.value })} /></Field>
            <Field label="Annual price (cents)"><Input type="number" value={edit.priceAnnualCents} onChange={(e) => setEdit({ ...edit, priceAnnualCents: e.target.value })} /></Field>
            <Field label="Currency"><Input value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value })} /></Field>
            <Field label="AI markup %"><Input type="number" value={edit.aiMarkupPercent} onChange={(e) => setEdit({ ...edit, aiMarkupPercent: e.target.value })} /></Field>
            <Field label="Limits (JSON)"><Textarea rows={8} className="font-mono text-xs" value={edit.limitsText} onChange={(e) => setEdit({ ...edit, limitsText: e.target.value })} /></Field>
            <Field label="Features (JSON)"><Textarea rows={8} className="font-mono text-xs" value={edit.featuresText} onChange={(e) => setEdit({ ...edit, featuresText: e.target.value })} /></Field>
            <Checkbox label="Active" checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} />
            <Checkbox label="Custom (hidden from public pricing)" checked={edit.isCustom} onChange={(v) => setEdit({ ...edit, isCustom: v })} />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function Billing() {
  const can = useCan();
  const toast = useToast();
  const subs = useQuery({ queryKey: ['admin', 'subs'], queryFn: () => get<any[]>('/admin/subscriptions') });
  const inv = useQuery({ queryKey: ['admin', 'invoices'], queryFn: () => get<any[]>('/admin/invoices') });
  const run = (type: string) => post('/admin/billing/run', { type }).then(() => toast({ tone: 'success', message: `${titleCase(type)} queued` }));
  return (
    <div className="space-y-6">
      {can('admin:plans:manage') && <div className="flex gap-2"><Button variant="outline" onClick={() => run('RENEWALS')}>Run renewals now</Button><Button variant="outline" onClick={() => run('AI_USAGE_INVOICES')}>Issue last month's AI invoices</Button></div>}
      <Card title="Invoices">
        <Table head={['Number', 'Customer', 'Type', 'Amount', 'Status', 'Issued', '']}>
          {inv.data?.map((i) => (
            <tr key={i.id}>
              <td className="px-4 py-2 font-mono text-xs">{i.number}</td><td className="px-4 py-2 text-xs">{i.enterpriseName ?? i.userEmail ?? '—'}</td><td className="px-4 py-2 text-xs">{titleCase(i.kind)}</td>
              <td className="px-4 py-2 tabular-nums">{cents(i.amountCents, i.currency)}</td><td className="px-4 py-2"><StatusBadge status={i.status} /></td><td className="px-4 py-2 text-xs">{fmtDate(i.issuedAt)}</td>
              <td className="px-4 py-2 text-right">{i.status === 'OPEN' && can('admin:plans:manage') && <Button size="sm" variant="ghost" onClick={async () => { await post(`/admin/invoices/${i.id}/mark-paid`); void inv.refetch(); }}>Mark paid</Button>}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Subscriptions">
        <Table head={['Customer', 'Plan', 'Interval', 'Status', 'Period end']}>
          {subs.data?.map((s) => <tr key={s.id}><td className="px-4 py-2 text-xs">{s.enterpriseName ?? s.userEmail}</td><td className="px-4 py-2">{s.plan}</td><td className="px-4 py-2 text-xs">{titleCase(s.interval)}</td><td className="px-4 py-2"><StatusBadge status={s.status} />{s.cancelAtPeriodEnd && <Badge tone="amber" className="ml-1">Cancels</Badge>}</td><td className="px-4 py-2 text-xs">{fmtDate(s.currentPeriodEnd)}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}

function AiAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: () => get<any[]>('/ai/providers') });
  const [edit, setEdit] = useState<any>(null);
  return (
    <div className="space-y-6">
      <AiConfigPanel scope="PLATFORM" title="Platform-managed AI" description="Used by users without their own or enterprise keys. Usage is billed to customers with the plan's AI markup." />
      <Card title="Provider catalog & pricing" description="Prices are per 1M tokens (USD) and drive cost calculation. Verify against each provider's current pricing.">
        <Table head={['Provider', 'Enabled', 'Models', '']}>
          {providers.data?.map((p) => (
            <tr key={p.key}>
              <td className="px-4 py-2 font-medium">{p.name}</td><td className="px-4 py-2">{p.enabled ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</td>
              <td className="px-4 py-2 text-xs">{p.models.map((m: any) => `${m.id} ($${m.inputPer1M}/$${m.outputPer1M})`).join(', ')}</td>
              <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEdit({ ...p, modelsText: JSON.stringify(p.models, null, 2) })}>Edit</Button></td>
            </tr>
          ))}
        </Table>
      </Card>
      <AiUsagePanel scope="PLATFORM" />
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit?.name}`} wide footer={<Button onClick={async () => { try { await put(`/admin/ai/providers/${edit.key}`, { enabled: edit.enabled, models: JSON.parse(edit.modelsText) }); setEdit(null); void qc.invalidateQueries({ queryKey: ['ai'] }); toast({ tone: 'success', message: 'Saved' }); } catch (e) { toast({ tone: 'error', message: (e as Error).message }); } }}>Save</Button>}>
        {edit && <div className="space-y-3"><Checkbox label="Enabled" checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} /><Field label="Models (JSON: id, label, inputPer1M, outputPer1M)"><Textarea rows={12} className="font-mono text-xs" value={edit.modelsText} onChange={(e) => setEdit({ ...edit, modelsText: e.target.value })} /></Field></div>}
      </Dialog>
    </div>
  );
}

function Integrations() {
  const q = useQuery({ queryKey: ['admin', 'integrations'], queryFn: () => get<any[]>('/admin/integrations') });
  return (
    <Card title="Platform integrations">
      {q.isLoading ? <Spinner /> : (
        <Table head={['Platform', ...INTEGRATION_OPERATIONS.map((o) => o.replace(/([A-Z])/g, ' $1')), 'Jobs seen (7d)', 'Connections']}>
          {q.data?.map((p) => (
            <tr key={p.key}>
              <td className="px-4 py-2 font-medium">{p.name}</td>
              {INTEGRATION_OPERATIONS.map((o) => <td key={o} className="px-4 py-2" title={p.capabilities[o].note}><StatusBadge status={p.capabilities[o].status} /></td>)}
              <td className="px-4 py-2 tabular-nums">{p.jobsSeen7d}</td>
              <td className="px-4 py-2 text-xs">{Object.entries(p.connections).map(([k, v]) => `${titleCase(k)}: ${v}`).join(', ') || '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function System() {
  const q = useQuery({ queryKey: ['admin', 'system'], queryFn: () => get<any>('/admin/system'), refetchInterval: 10_000 });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-6">
      <Card title="Queues">
        <Table head={['Queue', 'Waiting', 'Active', 'Delayed', 'Failed', 'Completed']}>
          {Object.entries(q.data.queues as Record<string, any>).map(([k, c]) => <tr key={k}><td className="px-4 py-2 font-mono text-xs">{k}</td>{['waiting', 'active', 'delayed', 'failed', 'completed'].map((s) => <td key={s} className={`px-4 py-2 tabular-nums ${s === 'failed' && c[s] ? 'text-rose-600' : ''}`}>{c[s]}</td>)}</tr>)}
        </Table>
      </Card>
      <Card title="Workers">{q.data.workers.length ? <ul className="text-sm">{q.data.workers.map((w: any) => <li key={w.id}><span className="font-mono">{w.id}</span> — {w.queues.join(', ')} — {ago(w.at)}</li>)}</ul> : <Alert tone="warn">No workers reporting.</Alert>}</Card>
      <Card title="Dead-letter queue (latest)">{q.data.deadLetters.length ? <ul className="space-y-1 text-xs">{q.data.deadLetters.map((d: any) => <li key={d.id}><span className="font-mono">{d.data.queue}</span> · {d.data.failedReason} · {fmtDate(d.timestamp)}</li>)}</ul> : <p className="text-sm text-slate-500">Empty.</p>}</Card>
    </div>
  );
}

function Audit() {
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['admin', 'audit', action], queryFn: () => get<any[]>(`/admin/audit-logs?action=${encodeURIComponent(action)}`) });
  return (
    <Card title="Audit log">
      <Input className="mb-4 max-w-xs" placeholder="Filter by action prefix (e.g. auth.)" value={action} onChange={(e) => setAction(e.target.value)} />
      <Table head={['When', 'Actor', 'Action', 'Target', 'IP']}>
        {q.data?.map((a) => <tr key={a.id}><td className="whitespace-nowrap px-4 py-2 text-xs">{fmtDate(a.createdAt)}</td><td className="px-4 py-2 text-xs">{a.actorEmail ?? 'system'}</td><td className="px-4 py-2 font-mono text-xs">{a.action}</td><td className="px-4 py-2 text-xs">{a.targetType ? `${a.targetType}:${String(a.targetId ?? '').slice(0, 8)}` : ''}</td><td className="px-4 py-2 text-xs">{a.ip ?? ''}</td></tr>)}
      </Table>
    </Card>
  );
}

function SettingsTab() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => get<Record<string, any>>('/admin/settings') });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-4">
      {Object.entries(q.data ?? {}).map(([k, v]) => (
        <Card key={k} title={k}>
          <Textarea rows={k === 'matching.weights' || k === 'limits.global' ? 6 : 1} className="font-mono text-xs" value={drafts[k] ?? JSON.stringify(v, null, 2)} onChange={(e) => setDrafts({ ...drafts, [k]: e.target.value })} />
          <Button size="sm" className="mt-2" onClick={async () => { try { await put(`/admin/settings/${k}`, { value: JSON.parse(drafts[k] ?? JSON.stringify(v)) }); toast({ tone: 'success', message: `${k} saved` }); void q.refetch(); } catch (e) { toast({ tone: 'error', message: (e as Error).message }); } }}>Save</Button>
        </Card>
      ))}
    </div>
  );
}

function AdminInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const tab = (sp.get('tab') as Tab) ?? 'overview';
  if (!can('admin:system:read')) return <Alert tone="warn">Administrator access required.</Alert>;
  const all: { value: Tab; label: string; perm: string }[] = [
    { value: 'overview', label: 'Overview', perm: 'admin:system:read' },
    { value: 'users', label: 'Users', perm: 'admin:users:read' },
    { value: 'enterprises', label: 'Enterprises', perm: 'admin:users:read' },
    { value: 'plans', label: 'Plans', perm: 'admin:plans:manage' },
    { value: 'billing', label: 'Billing', perm: 'admin:billing:read' },
    { value: 'ai', label: 'AI providers', perm: 'admin:ai:configure' },
    { value: 'integrations', label: 'Integrations', perm: 'admin:system:read' },
    { value: 'system', label: 'Queues & workers', perm: 'admin:system:read' },
    { value: 'audit', label: 'Audit log', perm: 'admin:audit:read' },
    { value: 'settings', label: 'Platform settings', perm: 'admin:settings:manage' },
  ];
  const tabs = all.filter((t) => can(t.perm));
  return (
    <>
      <PageHeader title="Administration" description="Platform-wide management, monitoring and billing." />
      <Tabs tabs={tabs} value={tab} onChange={(v) => router.replace(`/admin?tab=${v}`)} />
      <div className="mt-6">
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <Users />}
        {tab === 'enterprises' && <Enterprises />}
        {tab === 'plans' && <Plans />}
        {tab === 'billing' && <Billing />}
        {tab === 'ai' && <AiAdmin />}
        {tab === 'integrations' && <Integrations />}
        {tab === 'system' && <System />}
        {tab === 'audit' && <Audit />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminInner />
    </Suspense>
  );
}
