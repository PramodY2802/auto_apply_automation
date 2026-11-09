'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { JOB_VIEWS, PLATFORM_KEYS, type JobView } from '@autoapply/shared';
import { DiscoveryButton, type JobRow } from '@/components/job-bits';
import { Alert, Badge, Button, Empty, ErrorState, Input, PageHeader, Pagination, ScoreRing, Select, Spinner, StatusBadge, Table, Tabs, useToast } from '@/components/ui';
import { get, post } from '@/lib/api';
import { ago, money, titleCase } from '@/lib/utils';

function JobsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const view = (sp.get('view') as JobView) ?? 'ALL';
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [platform, setPlatform] = useState('');
  const [minScore, setMinScore] = useState('');
  const [sort, setSort] = useState('score');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const params = new URLSearchParams({ view, page: String(page), pageSize: '20', sort });
  if (q) params.set('q', q);
  if (platform) params.set('platform', platform);
  if (minScore) params.set('minScore', minScore);
  const list = useQuery({ queryKey: ['jobs', 'list', params.toString()], queryFn: () => get<{ items: JobRow[]; total: number; page: number; pageSize: number; disclaimer: string }>(`/jobs?${params}`) });
  const counts = useQuery({ queryKey: ['jobs', 'counts'], queryFn: () => get<Record<string, number>>('/jobs/views/counts') });
  const bulk = useMutation({
    mutationFn: (action: string) => post<any>('/jobs/bulk', { action, jobIds: selected, mode: 'MANUAL' }),
    onSuccess: (r, action) => {
      if (action === 'apply') {
        const ok = r.results.filter((x: any) => x.applicationId).length;
        const bad = r.results.filter((x: any) => x.error);
        toast({ tone: bad.length ? 'info' : 'success', message: `${ok} application(s) started${bad.length ? `; ${bad.length} skipped (${bad[0].error})` : ''}` });
      } else toast({ tone: 'success', message: `Updated ${r.updated} job(s)` });
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const setView = (v: JobView) => {
    setPage(1);
    setSelected([]);
    router.replace(`/jobs?view=${v}`);
  };
  const items = list.data?.items ?? [];
  return (
    <>
      <PageHeader title="Jobs" description="Every job discovered for you, from every source, in one place." actions={<DiscoveryButton />} />
      <Tabs tabs={JOB_VIEWS.map((v) => ({ value: v, label: titleCase(v), count: counts.data?.[v] }))} value={view} onChange={setView} />
      <div className="my-4 flex flex-wrap items-center gap-2">
        <form className="relative min-w-60 flex-1" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search title, company, location" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <Select className="w-40" value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }} aria-label="Platform">
          <option value="">All platforms</option>
          {PLATFORM_KEYS.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
        </Select>
        <Select className="w-36" value={minScore} onChange={(e) => { setMinScore(e.target.value); setPage(1); }} aria-label="Minimum score">
          <option value="">Any score</option><option value="50">50+</option><option value="70">70+</option><option value="85">85+</option>
        </Select>
        <Select className="w-40" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="score">Best match</option><option value="posted">Newest posted</option><option value="discovered">Recently found</option><option value="company">Company</option>
        </Select>
      </div>
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm">
          <span className="font-medium text-brand-800">{selected.length} selected</span>
          <Button size="sm" onClick={() => bulk.mutate('apply')} loading={bulk.isPending}>Prepare applications</Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate('save')}>Save</Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate('seen')}>Mark seen</Button>
          <Button size="sm" variant="ghost" onClick={() => bulk.mutate('hide')}>Hide</Button>
        </div>
      )}
      {list.isLoading ? <Spinner /> : list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : items.length === 0 ? (
        <Empty title="No jobs here yet" description={view === 'ALL' ? 'Run a search to discover jobs from your selected platforms, or capture jobs with the browser extension.' : 'Nothing in this view.'} action={<Link href="/preferences" className="text-sm text-brand-700 hover:underline">Review preferences</Link>} />
      ) : (
        <>
          <Table head={[<input key="all" type="checkbox" aria-label="Select all" checked={selected.length === items.length} onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.jobId) : [])} />, 'Match', 'Role', 'Location', 'Salary', 'Source', 'Posted', 'Status']}>
            {items.map((j) => (
              <tr key={j.jobId} className={j.disqualified ? 'opacity-60' : 'hover:bg-slate-50'}>
                <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${j.title}`} checked={selected.includes(j.jobId)} onChange={(e) => setSelected(e.target.checked ? [...selected, j.jobId] : selected.filter((x) => x !== j.jobId))} /></td>
                <td className="px-4 py-3"><ScoreRing score={j.score} size={38} /></td>
                <td className="max-w-sm px-4 py-3">
                  <Link href={`/jobs/${j.jobId}`} className="font-medium text-slate-900 hover:text-brand-700">{j.title}</Link>
                  {j.isNew && <Badge tone="brand" className="ml-2">New</Badge>}
                  <div className="text-xs text-slate-500">{j.company}</div>
                  <div className="mt-0.5 line-clamp-1 text-xs text-slate-400" title={j.summary}>{j.summary}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{j.location ?? '—'}{j.workMode && <div className="text-xs text-slate-400">{titleCase(j.workMode)}</div>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{money(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod) ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{(j.platforms ?? []).map(titleCase).join(', ')}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{ago(j.postedAt)}</td>
                <td className="px-4 py-3">{j.applicationStatus ? <Link href={`/applications/${j.applicationId}`}><StatusBadge status={j.applicationStatus} /></Link> : <span className="text-xs text-slate-400">Not applied</span>}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageSize={20} total={list.data?.total ?? 0} onPage={setPage} />
          <p className="text-xs text-slate-400">{list.data?.disclaimer}</p>
        </>
      )}
      {bulk.error && <Alert tone="error">{(bulk.error as Error).message}</Alert>}
    </>
  );
}

export default function JobsPage() {
  return (
    <Suspense>
      <JobsInner />
    </Suspense>
  );
}
