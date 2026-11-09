'use client';

import { useQuery } from '@tanstack/react-query';
import { Briefcase, CheckCircle2, Circle, ClipboardList, Sparkles, Target } from 'lucide-react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DiscoveryButton, JobCard, type JobRow } from '@/components/job-bits';
import { useMe } from '@/components/providers';
import { Card, Empty, Meter, PageHeader, Skeleton, Stat } from '@/components/ui';
import { get } from '@/lib/api';
import { titleCase } from '@/lib/utils';

export default function Dashboard() {
  const { data: me } = useMe();
  const counts = useQuery({ queryKey: ['jobs', 'counts'], queryFn: () => get<Record<string, number>>('/jobs/views/counts') });
  const stats = useQuery({ queryKey: ['applications', 'stats'], queryFn: () => get<{ byStatus: Record<string, number>; submittedLast30Days: { day: string; count: number }[] }>('/applications/stats') });
  const rec = useQuery({ queryKey: ['jobs', 'list', 'RECOMMENDED', 'dash'], queryFn: () => get<{ items: JobRow[] }>('/jobs?view=RECOMMENDED&pageSize=6') });
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: () => get<{ plan: { name: string }; usage: { metric: string; used: number; limit: number | null }[] }>('/billing/usage') });
  const ob = me?.onboarding;
  const steps = ob ? [
    { done: ob.resumeUploaded, label: 'Upload your resume', href: '/onboarding' },
    { done: ob.profileReviewed, label: 'Review your extracted profile', href: '/onboarding?step=review' },
    { done: ob.preferencesSet, label: 'Set job preferences', href: '/onboarding?step=titles' },
  ] : [];
  const by = stats.data?.byStatus ?? {};
  const days = (() => {
    const map = new Map((stats.data?.submittedLast30Days ?? []).map((d) => [d.day, d.count]));
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
      return { day: d.slice(5), count: map.get(d) ?? 0 };
    });
  })();
  return (
    <>
      <PageHeader title={`Hello, ${me?.user.fullName.split(' ')[0] ?? ''}`} description="Your job search at a glance." actions={me?.onboarding.preferencesSet && <DiscoveryButton />} />
      {steps.some((s) => !s.done) && (
        <Card className="mb-6" title="Finish setting up" description="Complete these steps to start discovering and applying.">
          <ol className="grid gap-3 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm hover:border-brand-500">
                  {s.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                  <span className={s.done ? 'text-slate-500 line-through' : 'font-medium text-slate-800'}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {counts.isLoading ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <Stat label="Jobs in feed" value={counts.data?.ALL ?? 0} hint={`${counts.data?.NEW ?? 0} new`} icon={<Briefcase className="h-4 w-4" />} />
            <Stat label="Recommended" value={counts.data?.RECOMMENDED ?? 0} hint="Score ≥ 70, not applied" icon={<Sparkles className="h-4 w-4" />} />
            <Stat label="Applied" value={(by.APPLIED ?? 0) + (by.INTERVIEW ?? 0) + (by.OFFER ?? 0) + (by.REJECTED ?? 0)} hint={`${by.INTERVIEW ?? 0} interviewing · ${by.OFFER ?? 0} offers`} icon={<Target className="h-4 w-4" />} />
            <Stat label="Need your attention" value={(by.PENDING_APPROVAL ?? 0) + (by.NEEDS_VERIFICATION ?? 0) + (by.FAILED ?? 0)} hint="Approvals, verifications, failures" icon={<ClipboardList className="h-4 w-4" />} />
          </>
        )}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Recommended jobs" actions={<Link className="text-sm text-brand-700 hover:underline" href="/jobs?view=RECOMMENDED">View all</Link>}>
          {rec.isLoading ? <Skeleton className="h-40" /> : rec.data?.items.length ? (
            <div className="-m-2 divide-y divide-slate-100">{rec.data.items.map((j) => <JobCard key={j.jobId} j={j} compact />)}</div>
          ) : (
            <Empty title="No recommendations yet" description="Set your preferences and run a search to see matching jobs." />
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Applications by status">
            {Object.keys(by).length === 0 ? <p className="text-sm text-slate-500">No applications yet.</p> : (
              <ul className="space-y-2 text-sm">
                {Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <li key={k} className="flex justify-between"><Link className="hover:underline" href={`/applications?status=${k}`}>{titleCase(k)}</Link><span className="font-medium tabular-nums">{v}</span></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Usage · ${usage.data?.plan.name ?? ''} plan`} actions={<Link href="/settings?tab=billing" className="text-xs text-brand-700 hover:underline">Manage</Link>}>
            <div className="space-y-3">
              {usage.data?.usage.filter((u) => u.metric !== 'STORAGE_BYTES').map((u) => <Meter key={u.metric} label={titleCase(u.metric)} value={u.used} max={u.limit} />)}
            </div>
          </Card>
        </div>
      </div>
      <Card className="mt-6" title="Applications submitted (last 30 days)">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} interval={4} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={28} />
              <Tooltip />
              <Bar dataKey="count" name="Submitted" fill="#4f46e5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}
