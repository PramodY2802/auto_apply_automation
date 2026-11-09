'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { defaultPrefs, PreferencesFields, type PrefsDraft } from '@/components/preferences-form';
import { ProfileEditor } from '@/components/profile-editor';
import { useMe } from '@/components/providers';
import { ExtractionStatus, ResumeDropzone } from '@/components/resume-upload';
import { Alert, Button, Card, PageHeader, Spinner, useToast } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { cn } from '@/lib/utils';

const STEPS = [
  { key: 'upload', label: 'Upload' },
  { key: 'extract', label: 'Extract' },
  { key: 'review', label: 'Review' },
  { key: 'titles', label: 'Roles' },
  { key: 'experience', label: 'Experience' },
  { key: 'locations', label: 'Locations' },
  { key: 'salary', label: 'Salary' },
  { key: 'more', label: 'Preferences' },
  { key: 'finish', label: 'Save' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

function Wizard() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const [step, setStep] = useState<StepKey>((params.get('step') as StepKey) ?? 'upload');
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [extractOk, setExtractOk] = useState(false);
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => get('/profile'), enabled: step === 'review' });
  const savedPrefs = useQuery({ queryKey: ['preferences'], queryFn: () => get('/preferences') });
  const [prefs, setPrefs] = useState<PrefsDraft | null>(null);
  useEffect(() => {
    if (savedPrefs.isSuccess && !prefs) setPrefs(defaultPrefs(savedPrefs.data));
  }, [savedPrefs.isSuccess, savedPrefs.data, prefs]);
  const idx = STEPS.findIndex((s) => s.key === step);
  const go = (k: StepKey) => {
    setStep(k);
    window.scrollTo({ top: 0 });
  };
  const next = () => go(STEPS[Math.min(STEPS.length - 1, idx + 1)]!.key);
  const back = () => go(STEPS[Math.max(0, idx - 1)]!.key);

  const save = useMutation({
    mutationFn: async (runSearch: boolean) => {
      await put('/preferences', prefs);
      if (runSearch) await post('/discovery/runs', {}).catch(() => undefined);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast({ tone: 'success', message: 'Preferences saved' });
      router.push('/jobs');
    },
  });

  const canNext = step === 'titles' ? (prefs?.titles.length ?? 0) > 0 : true;
  return (
    <>
      <PageHeader title="Set up your job search" description="About five minutes. You can change everything later." />
      <ol className="mb-8 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s.key} className={cn('flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium', i < idx ? 'bg-emerald-50 text-emerald-700' : i === idx ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>
            {i < idx ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>} {s.label}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <Card title="Upload your resume" description="We extract text natively from digital PDFs and DOCX, and use OCR with image cleanup for scans and photos.">
          <ResumeDropzone onUploaded={(r) => { setResumeId(r.resumeId); go('extract'); }} />
          {me?.onboarding.resumeUploaded && <Button variant="ghost" className="mt-4" onClick={() => go('review')}>I already uploaded a resume — skip</Button>}
        </Card>
      )}
      {step === 'extract' && resumeId && (
        <Card title="Understanding your resume">
          <ExtractionStatus resumeId={resumeId} onDone={setExtractOk} />
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => go('upload')}>Upload a different file</Button>
            <Button onClick={() => go('review')} disabled={!extractOk}>Review extracted profile</Button>
          </div>
        </Card>
      )}
      {step === 'review' && (profile.isLoading ? <Spinner /> : profile.data && <ProfileEditor initial={profile.data as any} reviewMode submitLabel="Confirm & continue" onSaved={() => go('titles')} />)}
      {['titles', 'experience', 'locations', 'salary', 'more'].includes(step) && prefs && (
        <>
          <PreferencesFields value={prefs} onChange={setPrefs} sections={step === 'more' ? ['more', 'automation'] : [step as 'titles']} features={me?.plan.features} />
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={back}>Back</Button>
            <Button onClick={next} disabled={!canNext}>Continue</Button>
          </div>
        </>
      )}
      {step === 'finish' && prefs && (
        <Card title="Ready to search">
          <p className="text-sm text-slate-600">We will search <strong>{prefs.platforms.join(', ')}</strong> for <strong>{prefs.titles.join(', ')}</strong>{prefs.locations.length ? ` in ${prefs.locations.map((l) => l.city || l.country).filter(Boolean).join(', ')}` : ''}.</p>
          {save.error && <div className="mt-3"><Alert tone="error">{(save.error as Error).message}</Alert></div>}
          <div className="mt-6 flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={back}>Back</Button>
            <div className="flex gap-2">
              <Button variant="outline" loading={save.isPending} onClick={() => save.mutate(false)}>Save preferences</Button>
              <Button loading={save.isPending} onClick={() => save.mutate(true)}>Save & find jobs</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <Wizard />
    </Suspense>
  );
}
