'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { get, post } from '@/lib/api';
import { ago, money, titleCase } from '@/lib/utils';
import { Badge, Button, ScoreRing, StatusBadge, useToast } from './ui';

export interface JobRow {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  workMode: string | null;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  postedAt: string | null;
  discoveredAt: string;
  score: number;
  missingSkills: string[];
  matchedSkills: string[];
  disqualified: boolean;
  summary: string;
  isNew: boolean;
  saved: boolean;
  applicationId: string | null;
  applicationStatus: string | null;
  platforms: string[] | null;
}

export function JobCard({ j, compact }: { j: JobRow; compact?: boolean }) {
  return (
    <Link href={`/jobs/${j.jobId}`} className="flex items-start gap-4 rounded-lg p-3 transition-colors hover:bg-slate-50">
      <ScoreRing score={j.score} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-slate-900">{j.title}</span>
          {j.isNew && <Badge tone="brand">New</Badge>}
          {j.applicationStatus && <StatusBadge status={j.applicationStatus} />}
        </div>
        <div className="mt-0.5 text-sm text-slate-500">
          {j.company} · {j.location ?? 'Location n/a'}
          {j.workMode && ` · ${titleCase(j.workMode)}`}
          {money(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod) && ` · ${money(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod)}`}
        </div>
        {!compact && j.missingSkills.length > 0 && <div className="mt-1 text-xs text-slate-500">Missing: {j.missingSkills.slice(0, 5).join(', ')}</div>}
      </div>
      <div className="hidden shrink-0 text-right text-xs text-slate-400 sm:block">
        {(j.platforms ?? []).map((p) => (
          <div key={p}>{titleCase(p)}</div>
        ))}
        <div>{ago(j.postedAt ?? j.discoveredAt)}</div>
      </div>
    </Link>
  );
}

/** Starts a discovery run and shows live progress. */
export function DiscoveryButton() {
  const qc = useQueryClient();
  const toast = useToast();
  const runs = useQuery({ queryKey: ['discovery-runs'], queryFn: () => get<any[]>('/discovery/runs?limit=1') });
  const latest = runs.data?.[0];
  const active = latest && ['QUEUED', 'RUNNING'].includes(latest.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ['discovery-runs'] }), 2000);
    return () => clearInterval(t);
  }, [active, qc]);
  useEffect(() => {
    if (latest && !active) void qc.invalidateQueries({ queryKey: ['jobs'] });
  }, [latest?.status, active, qc, latest]);
  const start = useMutation({
    mutationFn: () => post('/discovery/runs', {}),
    onSuccess: () => {
      toast({ tone: 'info', message: 'Searching connected platforms…' });
      void qc.invalidateQueries({ queryKey: ['discovery-runs'] });
    },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  return (
    <div className="flex items-center gap-3">
      {latest && (
        <span className="text-xs text-slate-500">
          Last search {ago(latest.finishedAt ?? latest.createdAt)} · <StatusBadge status={latest.status} /> {latest.stats && !active && `${latest.stats.found} found, ${latest.stats.created} new`}
        </span>
      )}
      <Button onClick={() => start.mutate()} loading={start.isPending || !!active}>
        <Play className="h-4 w-4" /> {active ? 'Searching…' : 'Find jobs now'}
      </Button>
    </div>
  );
}
