'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AiConfigPanel, AiUsagePanel } from '@/components/ai-config';
import { useCan } from '@/components/providers';
import { Alert, Button, Card, Checkbox, ConfirmButton, Empty, Field, Input, PageHeader, Select, Spinner, Stat, StatusBadge, Table, Tabs, useToast } from '@/components/ui';
import { del, get, post, put } from '@/lib/api';
import { ago, fmtDate, titleCase } from '@/lib/utils';

type Tab = 'overview' | 'members' | 'teams' | 'analytics' | 'ai' | 'settings' | 'activity';

function Overview() {
  const q = useQuery({ queryKey: ['enterprise'], queryFn: () => get<any>('/enterprise') });
  if (q.isLoading) return <Spinner />;
  const { enterprise, stats, subscription } = q.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Members" value={stats.members} />
        <Stat label="Jobs discovered" value={stats.jobsDiscovered} />
        <Stat label="Applications" value={stats.applications} />
        <Stat label="Applied" value={stats.applied} />
      </div>
      <Card title={enterprise.name} description={`Workspace · ${enterprise.slug}`}>
        {subscription ? (
          <p className="text-sm text-slate-600">
            {subscription.plan.name} plan · <StatusBadge status={subscription.subscription.status} /> · renews {fmtDate(subscription.subscription.currentPeriodEnd)} · up to {subscription.plan.limits.users} users. <a className="text-brand-700 hover:underline" href="/settings?tab=billing">Manage billing</a>
          </p>
        ) : <p className="text-sm text-slate-500">No subscription.</p>}
      </Card>
    </div>
  );
}

function Members() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const manage = can('enterprise:members:manage');
  const members = useQuery({ queryKey: ['enterprise', 'members'], queryFn: () => get<any[]>('/enterprise/members') });
  const teams = useQuery({ queryKey: ['enterprise', 'teams'], queryFn: () => get<any[]>('/enterprise/teams') });
  const invites = useQuery({ queryKey: ['enterprise', 'invites'], queryFn: () => get<any[]>('/enterprise/invitations'), enabled: manage });
  const [inv, setInv] = useState({ email: '', role: 'ENTERPRISE_USER', teamId: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['enterprise'] });
  const invite = useMutation({
    mutationFn: () => post('/enterprise/invitations', { email: inv.email, role: inv.role, teamId: inv.teamId || null }),
    onSuccess: () => { toast({ tone: 'success', message: `Invitation sent to ${inv.email}` }); setInv({ ...inv, email: '' }); void refresh(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: any }) => put(`/enterprise/members/${id}`, body), onSuccess: () => refresh(), onError: (e) => toast({ tone: 'error', message: (e as Error).message }) });
  return (
    <div className="space-y-6">
      {manage && (
        <Card title="Invite a team member">
          <form className="grid gap-3 md:grid-cols-[1fr_12rem_12rem_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
            <Field label="Email"><Input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
            <Field label="Role"><Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}><option value="ENTERPRISE_USER">Member</option><option value="ENTERPRISE_ADMIN">Admin</option></Select></Field>
            <Field label="Team"><Select value={inv.teamId} onChange={(e) => setInv({ ...inv, teamId: e.target.value })}><option value="">None</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Button type="submit" loading={invite.isPending}>Send invite</Button>
          </form>
        </Card>
      )}
      <Card title="Members">
        {members.isLoading ? <Spinner /> : (
          <Table head={['Member', 'Role', 'Team', 'Status', 'Applications', 'Last login', '']}>
            {members.data?.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2"><div className="font-medium">{m.fullName}</div><div className="text-xs text-slate-500">{m.email}</div></td>
                <td className="px-4 py-2">{manage ? <Select className="h-8 w-36" value={m.role} onChange={(e) => update.mutate({ id: m.id, body: { role: e.target.value } })}><option value="ENTERPRISE_USER">Member</option><option value="ENTERPRISE_ADMIN">Admin</option></Select> : titleCase(m.role)}</td>
                <td className="px-4 py-2">{manage ? <Select className="h-8 w-40" value={m.teamId ?? ''} onChange={(e) => update.mutate({ id: m.id, body: { teamId: e.target.value || null } })}><option value="">None</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select> : teams.data?.find((t) => t.id === m.teamId)?.name ?? '—'}</td>
                <td className="px-4 py-2"><StatusBadge status={m.status} /></td>
                <td className="px-4 py-2 tabular-nums">{m.applications}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{ago(m.lastLoginAt)}</td>
                <td className="px-4 py-2">{manage && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: m.id, body: { status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } })}>{m.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</Button>
                    <ConfirmButton size="sm" title="Remove member?" message={`${m.email} will lose access to the enterprise workspace and move to a free individual account.`} onConfirm={async () => { await del(`/enterprise/members/${m.id}`); await refresh(); }}>Remove</ConfirmButton>
                  </div>
                )}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {manage && (
        <Card title="Invitations">
          {invites.data?.length ? (
            <Table head={['Email', 'Role', 'Status', 'Expires', '']}>
              {invites.data.map((i) => {
                const st = i.acceptedAt ? 'Accepted' : i.revokedAt ? 'Revoked' : new Date(i.expiresAt) < new Date() ? 'Expired' : 'Pending';
                return (
                  <tr key={i.id}>
                    <td className="px-4 py-2">{i.email}</td><td className="px-4 py-2 text-xs">{titleCase(i.role)}</td><td className="px-4 py-2 text-xs">{st}</td><td className="px-4 py-2 text-xs">{fmtDate(i.expiresAt)}</td>
                    <td className="px-4 py-2 text-right">{st === 'Pending' && <Button size="sm" variant="ghost" onClick={async () => { await del(`/enterprise/invitations/${i.id}`); void refresh(); }}>Revoke</Button>}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <p className="text-sm text-slate-500">No invitations.</p>}
        </Card>
      )}
    </div>
  );
}

function Teams() {
  const qc = useQueryClient();
  const can = useCan();
  const teams = useQuery({ queryKey: ['enterprise', 'teams'], queryFn: () => get<any[]>('/enterprise/teams') });
  const [name, setName] = useState('');
  return (
    <Card title="Teams">
      {can('enterprise:members:manage') && (
        <form className="mb-4 flex max-w-md gap-2" onSubmit={async (e) => { e.preventDefault(); await post('/enterprise/teams', { name }); setName(''); void qc.invalidateQueries({ queryKey: ['enterprise'] }); }}>
          <Input placeholder="Team name" required value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit">Create</Button>
        </form>
      )}
      {teams.data?.length ? (
        <ul className="divide-y divide-slate-100">
          {teams.data.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium">{t.name} <span className="text-xs font-normal text-slate-500">· {t.members} members</span></span>
              {can('enterprise:members:manage') && <ConfirmButton size="sm" title="Delete team?" message="Members stay in the enterprise, unassigned." onConfirm={async () => { await del(`/enterprise/teams/${t.id}`); await qc.invalidateQueries({ queryKey: ['enterprise'] }); }}>Delete</ConfirmButton>}
            </li>
          ))}
        </ul>
      ) : <Empty title="No teams" description="Group members into teams to compare activity." />}
    </Card>
  );
}

function Analytics() {
  const q = useQuery({ queryKey: ['enterprise', 'analytics'], queryFn: () => get<any>('/enterprise/analytics') });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Object.entries(d.applicationsByStatus as Record<string, number>).slice(0, 4).map(([k, v]) => <Stat key={k} label={titleCase(k)} value={v} />)}
        <Stat label="AI tokens (30d)" value={d.ai.tokens.toLocaleString()} hint={`$${d.ai.costUsd.toFixed(2)}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Applications created per day">
          <div className="h-64"><ResponsiveContainer><LineChart data={d.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} /><Tooltip /><Line dataKey="count" stroke="#4f46e5" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
        </Card>
        <Card title="By team">
          <div className="h-64"><ResponsiveContainer><BarChart data={d.byTeam}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="team" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} /><Tooltip /><Bar dataKey="applications" fill="#a5b4fc" name="Applications" /><Bar dataKey="applied" fill="#4f46e5" name="Applied" /></BarChart></ResponsiveContainer></div>
        </Card>
      </div>
    </div>
  );
}

function Settings() {
  const q = useQuery({ queryKey: ['enterprise'], queryFn: () => get<any>('/enterprise') });
  const toast = useToast();
  const qc = useQueryClient();
  const [s, setS] = useState<any>(null);
  if (q.isSuccess && !s) setS({ name: q.data.enterprise.name, ...q.data.enterprise.settings });
  if (!s) return <Spinner />;
  return (
    <Card title="Enterprise settings">
      <div className="max-w-xl space-y-4">
        <Field label="Name"><Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
        <Checkbox label="Allow members to use their own AI keys" checked={!!s.allowUserAiKeys} onChange={(v) => setS({ ...s, allowUserAiKeys: v })} />
        <Checkbox label="Allow platform-managed AI when no enterprise provider is configured" description="When off, members can only use enterprise-approved providers." checked={s.allowPlatformAi !== false} onChange={(v) => setS({ ...s, allowPlatformAi: v })} />
        <Button onClick={async () => { try { await put('/enterprise/settings', { name: s.name, allowUserAiKeys: !!s.allowUserAiKeys, allowPlatformAi: s.allowPlatformAi !== false }); toast({ tone: 'success', message: 'Saved' }); void qc.invalidateQueries({ queryKey: ['enterprise'] }); } catch (e) { toast({ tone: 'error', message: (e as Error).message }); } }}>Save settings</Button>
      </div>
    </Card>
  );
}

function Activity() {
  const q = useQuery({ queryKey: ['enterprise', 'activity'], queryFn: () => get<any[]>('/enterprise/activity') });
  return (
    <Card title="Audit history">
      {q.isLoading ? <Spinner /> : (
        <Table head={['When', 'Who', 'Action', 'Target']}>
          {q.data?.map((a) => <tr key={a.id}><td className="px-4 py-2 text-xs">{fmtDate(a.createdAt)}</td><td className="px-4 py-2 text-xs">{a.actorEmail ?? 'system'}</td><td className="px-4 py-2 font-mono text-xs">{a.action}</td><td className="px-4 py-2 text-xs text-slate-500">{a.targetType ?? ''}</td></tr>)}
        </Table>
      )}
    </Card>
  );
}

function EnterpriseInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const tab = (sp.get('tab') as Tab) ?? 'overview';
  if (!can('enterprise:read')) return <Alert tone="warn">Only enterprise admins can open the enterprise panel.</Alert>;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'members', label: 'Members & invitations' },
    { value: 'teams', label: 'Teams' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'ai', label: 'AI providers & usage' },
    { value: 'settings', label: 'Settings' },
    { value: 'activity', label: 'Audit history' },
  ];
  return (
    <>
      <PageHeader title="Enterprise" description="Manage your team, AI configuration and usage. All data is scoped to your organisation." />
      <Tabs tabs={tabs} value={tab} onChange={(v) => router.replace(`/enterprise?tab=${v}`)} />
      <div className="mt-6">
        {tab === 'overview' && <Overview />}
        {tab === 'members' && <Members />}
        {tab === 'teams' && <Teams />}
        {tab === 'analytics' && <Analytics />}
        {tab === 'ai' && <div className="space-y-6">{can('enterprise:ai:configure') && <AiConfigPanel scope="ENTERPRISE" title="Enterprise-managed AI" description="Members use these providers (billed to your keys) ahead of platform-managed AI." />}<AiUsagePanel scope="ENTERPRISE" /></div>}
        {tab === 'settings' && <Settings />}
        {tab === 'activity' && <Activity />}
      </div>
    </>
  );
}

export default function EnterprisePage() {
  return (
    <Suspense>
      <EnterpriseInner />
    </Suspense>
  );
}
