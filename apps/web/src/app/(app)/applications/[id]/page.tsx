'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Lock, ShieldAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, ConfirmButton, Dialog, ErrorState, Field, Input, PageHeader, Select, Spinner, StatusBadge, Textarea, useToast } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { cn, fmtDate, titleCase } from '@/lib/utils';

function AnswerRow({ a, appId, locked, onSaved }: { a: any; appId: string; locked: boolean; onSaved: () => void }) {
  const [value, setValue] = useState<string>(a.answer ?? '');
  const [reuse, setReuse] = useState(false);
  const toast = useToast();
  useEffect(() => setValue(a.answer ?? ''), [a.answer]);
  const save = useMutation({
    mutationFn: () => put(`/applications/${appId}/answers/${a.id}`, { answer: value, approve: true, saveForReuse: reuse }),
    onSuccess: () => { toast({ tone: 'success', message: 'Answer saved & approved' }); onSaved(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const needs = a.requiresUserInput || a.approvalStatus === 'PENDING';
  const choice = a.options.length > 0 && !['TEXT', 'TEXTAREA'].includes(a.questionType);
  return (
    <div className={cn('rounded-lg border p-4', a.requiresUserInput && a.required ? 'border-rose-200 bg-rose-50/30' : needs ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-sm font-medium text-slate-900">{a.question}{a.required && <span className="text-rose-600"> *</span>}</div>
        <div className="flex flex-wrap gap-1">
          {a.isSensitive && <Badge tone="red"><ShieldAlert className="h-3 w-3" />Sensitive</Badge>}
          {a.source && <Badge tone={a.source === 'AI' ? 'violet' : 'slate'}>{a.source === 'AI' && <Sparkles className="h-3 w-3" />}{titleCase(a.source)}</Badge>}
          <Badge tone={a.approvalStatus === 'APPROVED' || a.approvalStatus === 'AUTO_APPROVED' ? 'green' : 'amber'}>{titleCase(a.approvalStatus)}</Badge>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">{a.reasoning}{a.confidence != null && ` · confidence ${Math.round(a.confidence * 100)}%`}</p>
      {a.questionType === 'FILE' ? (
        <p className="mt-2 text-sm text-slate-600">{a.answer ? 'Your selected resume will be attached.' : 'No file selected.'}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex-1">
            {a.questionType === 'CHECKBOX' ? (
              <Checkbox label="Yes, I confirm" checked={value === 'true'} onChange={(v) => setValue(v ? 'true' : 'false')} disabled={locked} />
            ) : choice ? (
              <Select value={value} onChange={(e) => setValue(e.target.value)} disabled={locked} aria-label={a.question}>
                <option value="">Select…</option>
                {a.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : a.questionType === 'TEXTAREA' ? (
              <Textarea value={value} onChange={(e) => setValue(e.target.value)} disabled={locked} rows={4} aria-label={a.question} />
            ) : (
              <Input value={value} onChange={(e) => setValue(e.target.value)} disabled={locked} aria-label={a.question} />
            )}
          </div>
          {!locked && (
            <div className="flex shrink-0 flex-col gap-1">
              <Button size="sm" variant={needs ? 'primary' : 'outline'} loading={save.isPending} disabled={value === '' && a.required} onClick={() => save.mutate()}>Save & approve</Button>
              {a.questionType !== 'CHECKBOX' && <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />Reuse later</label>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['application', id],
    queryFn: () => get<any>(`/applications/${id}`),
    refetchInterval: (query) => (['READY_TO_APPLY', 'IN_PROGRESS'].includes(query.state.data?.application?.status) && query.state.data?.application?.formSnapshot?.submission !== 'USER_ASSISTED' ? 2000 : false),
  });
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [evidence, setEvidence] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['application', id] });
    void qc.invalidateQueries({ queryKey: ['applications'] });
  };
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => post(`/applications/${id}/${path}`, body ?? {}),
    onSuccess: (_r, v) => { toast({ tone: 'success', message: v.path === 'approve' ? 'Approved — submitting now' : 'Done' }); refresh(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const { application: app, job, source, submitCapability, answers, events, history } = q.data;
  const locked = ['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN', 'IN_PROGRESS'].includes(app.status);
  const sensitive = answers.filter((a: any) => a.isSensitive && a.answer != null);
  const blocking = answers.filter((a: any) => a.required && (a.answer == null || a.answer === '' || a.requiresUserInput));
  const userAssisted = app.formSnapshot?.submission === 'USER_ASSISTED' || submitCapability?.status !== 'IMPLEMENTED';
  const preparing = ['READY_TO_APPLY', 'IN_PROGRESS'].includes(app.status) && !userAssisted;
  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{job.title} <StatusBadge status={app.status} /></span>}
        description={<>{job.company} · via {titleCase(app.platform)} · {titleCase(app.mode)} mode · {titleCase(app.source)}</>}
        actions={
          <>
            {source && <a href={source.applyUrl ?? source.url} target="_blank" rel="noopener noreferrer"><Button variant="outline"><ExternalLink className="h-4 w-4" />Open posting</Button></a>}
            {['APPLIED', 'INTERVIEW', 'NEEDS_VERIFICATION', 'UNKNOWN'].includes(app.status) && <Button variant="outline" loading={action.isPending} onClick={() => action.mutate({ path: 'sync' })}>Sync status</Button>}
            {['READY_TO_APPLY', 'FAILED', 'PENDING_APPROVAL'].includes(app.status) && !userAssisted && <Button variant="outline" onClick={() => action.mutate({ path: 'prepare' })}>Re-prepare</Button>}
            {!['WITHDRAWN', 'REJECTED', 'OFFER'].includes(app.status) && <ConfirmButton title="Withdraw application?" message="It will be marked as withdrawn in your tracker. This does not contact the employer." onConfirm={() => action.mutateAsync({ path: 'withdraw' })}>Withdraw</ConfirmButton>}
          </>
        }
      />
      {preparing && <Alert tone="info" title="Working on it">{app.status === 'IN_PROGRESS' ? 'Detecting the form, generating answers or submitting…' : 'Queued for preparation…'}</Alert>}
      {app.status === 'FAILED' && app.error && <Alert tone="error" title="Application failed">{app.error.message}</Alert>}
      {app.status === 'NEEDS_VERIFICATION' && <Alert tone="warn" title="Please verify">We couldn't confirm this submission automatically. Check the platform and confirm below if it went through.</Alert>}
      {userAssisted && !['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'].includes(app.status) && (
        <Alert tone="info" title="User-assisted platform">{submitCapability?.note ?? 'Automated submission is not permitted on this platform.'} Open the posting, use the AutoApply extension to fill your approved answers, submit yourself, then confirm here.</Alert>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Questions & answers" description={answers.length ? `${answers.length} fields · ${blocking.length} need your input` : undefined}>
            {answers.length === 0 ? <p className="text-sm text-slate-500">{preparing ? 'Answers will appear once the form is detected.' : 'No form fields were detected for this application.'}</p> : (
              <div className="space-y-3">{answers.map((a: any) => <AnswerRow key={a.id} a={a} appId={id} locked={locked} onSaved={refresh} />)}</div>
            )}
          </Card>
          {app.status === 'PENDING_APPROVAL' && (
            <Card title="Approve & submit">
              {blocking.length > 0 && <Alert tone="warn" title={`${blocking.length} required answer(s) missing`}>{blocking.map((b: any) => b.question).join(' · ')}</Alert>}
              {sensitive.length > 0 && (
                <div className="my-4 rounded-lg border border-rose-200 bg-rose-50/40 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-900"><Lock className="h-4 w-4" />Sensitive & legal declarations</div>
                  <ul className="mb-3 space-y-1 text-sm text-slate-700">{sensitive.map((s: any) => <li key={s.id}><strong>{s.question}</strong> → {s.options.find((o: any) => o.value === s.answer)?.label ?? s.answer}</li>)}</ul>
                  <Checkbox label="I confirm these declarations are true" checked={confirmSensitive} onChange={setConfirmSensitive} />
                </div>
              )}
              <Button className="w-full" disabled={blocking.length > 0 || (sensitive.length > 0 && !confirmSensitive)} loading={action.isPending} onClick={() => action.mutate({ path: 'approve', body: { confirmSensitive } })}>Approve and submit application</Button>
            </Card>
          )}
          {(userAssisted || app.status === 'NEEDS_VERIFICATION') && !['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'].includes(app.status) && (
            <Card title="Did you submit it?"><Button onClick={() => setConfirmOpen(true)}>I submitted this application</Button></Card>
          )}
        </div>
        <div className="space-y-6">
          {app.confirmation && (
            <Card title="Submission evidence">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Verified</dt><dd>{app.confirmation.verified ? <Badge tone="green">Platform confirmed</Badge> : <Badge tone="amber">{titleCase(app.confirmation.method)}</Badge>}</dd></div>
                {app.externalApplicationId && <div className="flex justify-between"><dt className="text-slate-500">Reference</dt><dd className="font-mono text-xs">{app.externalApplicationId}</dd></div>}
                <div className="flex justify-between"><dt className="text-slate-500">Submitted</dt><dd>{fmtDate(app.submittedAt)}</dd></div>
              </dl>
              {app.confirmation.confirmationText && <p className="mt-2 whitespace-pre-line rounded bg-slate-50 p-2 text-xs text-slate-600">{app.confirmation.confirmationText}</p>}
              {app.confirmation.screenshotKey && <img alt="Confirmation page screenshot" className="mt-3 rounded border border-slate-200" src={`/api/v1/applications/${id}/evidence`} />}
            </Card>
          )}
          {['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'UNKNOWN'].includes(app.status) && (
            <Card title="Update outcome">
              <div className="flex flex-wrap gap-2">
                {['INTERVIEW', 'OFFER', 'REJECTED'].filter((s) => s !== app.status).map((s) => <Button key={s} size="sm" variant="outline" onClick={() => action.mutate({ path: 'status', body: { status: s } })}>{titleCase(s)}</Button>)}
              </div>
            </Card>
          )}
          <Card title="Timeline">
            <ol className="relative space-y-4 border-l border-slate-200 pl-4">
              {[...events].reverse().map((e: any) => (
                <li key={e.id}>
                  <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500" />
                  <div className="text-xs text-slate-400">{fmtDate(e.createdAt)} · {titleCase(e.type)}</div>
                  <div className="text-sm text-slate-700">{e.message}</div>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Status history">
            <ul className="space-y-1 text-xs text-slate-600">
              {history.map((h: any) => <li key={h.id}>{fmtDate(h.createdAt)} — {h.fromStatus ? `${titleCase(h.fromStatus)} → ` : ''}<strong>{titleCase(h.toStatus)}</strong> <span className="text-slate-400">({h.actorType.toLowerCase()}{h.reason ? `: ${h.reason}` : ''})</span></li>)}
            </ul>
          </Card>
          <Link href={`/jobs/${job.id}`} className="block text-sm text-brand-700 hover:underline">← Back to job</Link>
        </div>
      </div>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm submission" footer={<Button loading={action.isPending} onClick={async () => { await action.mutateAsync({ path: 'confirm-submitted', body: { confirm: true, evidence: evidence || undefined } }); setConfirmOpen(false); }}>Mark as applied</Button>}>
        <p className="mb-3 text-sm text-slate-600">This will be recorded as <strong>user-confirmed</strong>, not platform-verified.</p>
        <Field label="Confirmation details (optional)" hint="e.g. the confirmation message or reference number"><Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}
