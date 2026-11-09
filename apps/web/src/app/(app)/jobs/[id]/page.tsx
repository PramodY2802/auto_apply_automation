'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '@/components/providers';
import { Alert, Badge, Button, Card, Checkbox, Dialog, ErrorState, PageHeader, ScoreRing, Select, Spinner, StatusBadge, useToast } from '@/components/ui';
import { get, post } from '@/lib/api';
import { ago, money, titleCase } from '@/lib/utils';

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['job', id], queryFn: () => get<any>(`/jobs/${id}`) });
  const [mode, setMode] = useState<'MANUAL' | 'AUTOMATIC'>('MANUAL');
  const [external, setExternal] = useState(false);
  const [confirmExt, setConfirmExt] = useState(false);
  const apply = useMutation({
    mutationFn: () => post<any>('/applications', { jobId: id, mode }),
    onSuccess: (a) => { toast({ tone: 'success', message: 'Preparing your application…' }); router.push(`/applications/${a.id}`); },
    onError: (e: any) => (e.body?.details?.applicationId ? router.push(`/applications/${e.body.details.applicationId}`) : toast({ tone: 'error', message: e.message })),
  });
  const recordExt = useMutation({
    mutationFn: () => post<any>('/applications/external', { jobId: id, userConfirmed: true }),
    onSuccess: (a) => { setExternal(false); void qc.invalidateQueries({ queryKey: ['job', id] }); router.push(`/applications/${a.id}`); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const flag = (action: string) => post(`/jobs/${id}/flags/${action}`).then(() => qc.invalidateQueries({ queryKey: ['job', id] }));
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const { job, sources, match, application, applyCapabilities, disclaimer } = q.data;
  const automated = applyCapabilities.some((c: any) => c.status === 'IMPLEMENTED');
  return (
    <>
      <PageHeader
        title={job.title}
        description={<>{job.company} · {job.location ?? 'Location n/a'}{job.workMode && ` · ${titleCase(job.workMode)}`}{job.employmentType && ` · ${titleCase(job.employmentType)}`}</>}
        actions={
          <>
            <Button variant="ghost" onClick={() => flag(match.saved ? 'unsave' : 'save')}>{match.saved ? 'Saved' : 'Save'}</Button>
            <Button variant="ghost" onClick={() => flag(match.hidden ? 'unhide' : 'hide')}>{match.hidden ? 'Unhide' : 'Hide'}</Button>
            {application ? <Link href={`/applications/${application.id}`}><Button>View application <StatusBadge status={application.status} /></Button></Link> : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Description">
            <div className="prose-job whitespace-pre-line text-sm leading-relaxed text-slate-700">{job.description || 'No description provided.'}</div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Match">
            <div className="flex items-center gap-4">
              <ScoreRing score={match.overallScore} size={64} />
              <p className="text-sm text-slate-600">{match.explanation.summary}</p>
            </div>
            <ul className="mt-4 space-y-2">
              {match.explanation.factors.map((f: any) => (
                <li key={f.factor}>
                  <div className="flex justify-between text-xs"><span className="font-medium capitalize text-slate-700">{f.factor} <span className="text-slate-400">({Math.round(f.weight * 100)}%)</span></span><span className="tabular-nums">{Math.round(f.score)}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${f.score}%` }} /></div>
                  <p className="mt-0.5 text-xs text-slate-500">{f.detail}</p>
                </li>
              ))}
            </ul>
            {match.explanation.disqualifiers.length > 0 && <div className="mt-3"><Alert tone="warn" title="Outside your preferences">{match.explanation.disqualifiers.join('; ')}</Alert></div>}
            <div className="mt-4 flex flex-wrap gap-1">
              {match.matchedSkills.map((s: string) => <Badge key={s} tone="green">{s}</Badge>)}
              {match.missingSkills.map((s: string) => <Badge key={s} tone="slate">{s}</Badge>)}
            </div>
            <p className="mt-3 text-xs text-slate-400">{disclaimer}</p>
          </Card>
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Salary</dt><dd>{money(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod) ?? 'Not disclosed'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Experience</dt><dd>{job.experienceMinYears != null ? `${job.experienceMinYears}${job.experienceMaxYears != null ? `–${job.experienceMaxYears}` : '+'} yrs` : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Posted</dt><dd>{ago(job.postedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Discovered</dt><dd>{ago(job.discoveredAt)}</dd></div>
            </dl>
            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase text-slate-500">Sources</h3>
            <ul className="space-y-1 text-sm">
              {sources.map((s: any) => (
                <li key={s.id} className="flex items-center justify-between">
                  <a className="inline-flex items-center gap-1 text-brand-700 hover:underline" href={s.url} target="_blank" rel="noopener noreferrer">{titleCase(s.platform)} <ExternalLink className="h-3 w-3" /></a>
                  <StatusBadge status={applyCapabilities.find((c: any) => c.platform === s.platform)?.status ?? 'UNSUPPORTED'} />
                </li>
              ))}
            </ul>
          </Card>
          {!application && (
            <Card title="Apply">
              {automated ? (
                <>
                  <Select value={mode} onChange={(e) => setMode(e.target.value as 'MANUAL')} aria-label="Application mode">
                    <option value="MANUAL">Manual — review before submitting</option>
                    <option value="AUTOMATIC" disabled={!me?.plan.features.autoApply}>Automatic — submit when all answers are verified</option>
                  </Select>
                  <Button className="mt-3 w-full" loading={apply.isPending} onClick={() => apply.mutate()}>Prepare application</Button>
                </>
              ) : (
                <>
                  <Alert tone="info">This platform doesn't permit automated submission. We'll prepare your answers; open the posting and use the AutoApply extension to fill them, then submit yourself.</Alert>
                  <Button className="mt-3 w-full" loading={apply.isPending} onClick={() => apply.mutate()}>Prepare answers</Button>
                </>
              )}
              <Button variant="ghost" className="mt-2 w-full" onClick={() => setExternal(true)}>I already applied elsewhere</Button>
            </Card>
          )}
        </div>
      </div>
      <Dialog open={external} onClose={() => setExternal(false)} title="Record an application you made directly" footer={<Button disabled={!confirmExt} loading={recordExt.isPending} onClick={() => recordExt.mutate()}>Record as applied</Button>}>
        <Checkbox label="I confirm I submitted an application for this job" description="It will be tracked as user-confirmed (not platform-verified)." checked={confirmExt} onChange={setConfirmExt} />
      </Dialog>
    </>
  );
}
