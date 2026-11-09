'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Badge, Empty, ErrorState, PageHeader, Pagination, Spinner, StatusBadge, Table, Tabs } from '@/components/ui';
import { get } from '@/lib/api';
import { ago, titleCase } from '@/lib/utils';

const GROUPS = [
  { value: '', label: 'All' },
  { value: 'PENDING_APPROVAL', label: 'Needs approval' },
  { value: 'READY_TO_APPLY,IN_PROGRESS', label: 'In progress' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'INTERVIEW', label: 'Interview' },
  { value: 'OFFER', label: 'Offer' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'NEEDS_VERIFICATION,UNKNOWN', label: 'Needs verification' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const status = sp.get('status') ?? '';
  const [page, setPage] = useState(1);
  const stats = useQuery({ queryKey: ['applications', 'stats'], queryFn: () => get<{ byStatus: Record<string, number> }>('/applications/stats') });
  const list = useQuery({ queryKey: ['applications', 'list', status, page], queryFn: () => get<{ items: any[]; total: number }>(`/applications?page=${page}${status ? `&status=${status}` : ''}`), refetchInterval: 10_000 });
  const count = (v: string) => (v ? v.split(',').reduce((s, k) => s + (stats.data?.byStatus[k] ?? 0), 0) : Object.values(stats.data?.byStatus ?? {}).reduce((a, b) => a + b, 0));
  return (
    <>
      <PageHeader title="Applications" description="Every application — prepared here or recorded from elsewhere — with its full history." />
      <Tabs tabs={GROUPS.map((g) => ({ value: g.value, label: g.label, count: count(g.value) }))} value={status} onChange={(v) => { setPage(1); router.replace(`/applications${v ? `?status=${v}` : ''}`); }} />
      <div className="mt-4">
        {list.isLoading ? <Spinner /> : list.error ? <ErrorState error={list.error} /> : !list.data?.items.length ? (
          <Empty title="No applications" description="Open a job and choose “Prepare application” to get started." action={<Link className="text-sm text-brand-700 hover:underline" href="/jobs?view=RECOMMENDED">Browse recommended jobs</Link>} />
        ) : (
          <>
            <Table head={['Role', 'Status', 'Mode', 'Platform', 'Submitted', 'Updated']}>
              {list.data.items.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/applications/${a.id}`} className="font-medium text-slate-900 hover:text-brand-700">{a.title}</Link>
                    <div className="text-xs text-slate-500">{a.company}</div>
                    {a.pendingAnswers > 0 && a.status === 'PENDING_APPROVAL' && <Badge tone="amber" className="mt-1">{a.pendingAnswers} answers to review</Badge>}
                    {a.error && a.status === 'FAILED' && <div className="mt-1 line-clamp-1 text-xs text-rose-600">{a.error.message}</div>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{titleCase(a.mode)} · {titleCase(a.source)}</td>
                  <td className="px-4 py-3 text-slate-600">{titleCase(a.platform)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{a.submittedAt ? ago(a.submittedAt) : '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{ago(a.updatedAt)}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
