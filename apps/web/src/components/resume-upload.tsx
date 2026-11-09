'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { FileUp, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, get } from '@/lib/api';
import { cn, titleCase } from '@/lib/utils';
import { Alert, Badge, StatusBadge } from './ui';

export function ResumeDropzone({ onUploaded }: { onUploaded: (r: { resumeId: string; extractionId: string }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const up = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ resume: { id: string }; extractionId: string }>('/resumes', { form });
    },
    onSuccess: (r) => onUploaded({ resumeId: r.resume.id, extractionId: r.extractionId }),
  });
  const pick = (f?: File | null) => f && up.mutate(f);
  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
        className={cn('flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors', drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-400')}
      >
        {up.isPending ? <Loader2 className="h-8 w-8 animate-spin text-brand-600" /> : <FileUp className="h-8 w-8 text-brand-600" />}
        <span className="mt-3 text-sm font-medium text-slate-900">{up.isPending ? 'Uploading…' : 'Drop your resume here or click to browse'}</span>
        <span className="mt-1 text-xs text-slate-500">PDF, DOCX, scanned PDF, JPG or PNG · up to 10 MB</span>
      </button>
      <input ref={input} type="file" className="hidden" accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => pick(e.target.files?.[0])} />
      {up.error && <div className="mt-3"><Alert tone="error">{(up.error as Error).message}</Alert></div>}
    </div>
  );
}

export function ExtractionStatus({ resumeId, onDone }: { resumeId: string; onDone?: (ok: boolean) => void }) {
  const q = useQuery({
    queryKey: ['extraction', resumeId],
    queryFn: () => get<{ extraction: any }>(`/resumes/${resumeId}/extraction`),
    refetchInterval: (query) => (['SUCCEEDED', 'FAILED'].includes(query.state.data?.extraction?.status) ? false : 1500),
  });
  const ex = q.data?.extraction;
  const done = ex && ['SUCCEEDED', 'FAILED'].includes(ex.status);
  if (done && onDone) setTimeout(() => onDone(ex.status === 'SUCCEEDED'), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={ex?.status ?? 'PENDING'} />
        {ex?.method && <Badge tone="blue">{titleCase(ex.method)}</Badge>}
        {ex?.ocrEngine && <Badge tone="violet">OCR: {ex.ocrEngine}</Badge>}
        {ex?.parser && <Badge tone={ex.parser === 'ai' ? 'brand' : 'slate'}>{ex.parser === 'ai' ? `AI: ${ex.aiProvider}/${ex.aiModel}` : 'Deterministic parser'}</Badge>}
        {!done && <span className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading your document…</span>}
      </div>
      {ex?.steps?.length > 0 && (
        <ol className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          {ex.steps.map((s: any, i: number) => (
            <li key={i} className="flex justify-between rounded bg-slate-50 px-2 py-1">
              <span>{s.step}{s.detail ? ` — ${s.detail}` : ''}</span>
              <span className={s.status === 'error' ? 'text-rose-600' : s.status === 'skipped' ? 'text-slate-400' : 'text-emerald-600'}>{s.status} · {s.ms}ms</span>
            </li>
          ))}
        </ol>
      )}
      {ex?.warnings?.length > 0 && (
        <Alert tone="warn" title="Please double-check">
          <ul className="list-disc pl-4">{ex.warnings.slice(0, 8).map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
        </Alert>
      )}
      {ex?.status === 'FAILED' && <Alert tone="error" title="Extraction failed">{ex.errors?.map((e: any) => e.message).join('; ')}</Alert>}
    </div>
  );
}
