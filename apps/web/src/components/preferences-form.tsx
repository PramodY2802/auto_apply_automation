'use client';

import { Plus, Trash2 } from 'lucide-react';
import { EMPLOYMENT_TYPES, PLATFORM_KEYS, WORK_MODES, type PreferencesInput } from '@autoapply/shared';
import { titleCase } from '@/lib/utils';
import { Alert, Button, Card, Checkbox, ChipInput, Field, Input, Select } from './ui';

export type PrefsDraft = PreferencesInput;

export function defaultPrefs(saved?: any): PrefsDraft {
  return {
    titles: saved?.titles ?? [],
    experienceBand: saved?.experienceBand ?? 'CUSTOM',
    experienceMinYears: saved?.experienceMinYears ?? null,
    experienceMaxYears: saved?.experienceMaxYears ?? null,
    locations: saved?.locations ?? [],
    workModes: saved?.workModes ?? ['REMOTE', 'HYBRID', 'ONSITE'],
    employmentTypes: saved?.employmentTypes ?? ['FULL_TIME'],
    salaryMin: saved?.salaryMin ?? null,
    salaryMax: saved?.salaryMax ?? null,
    salaryCurrency: saved?.salaryCurrency ?? 'USD',
    salaryPeriod: saved?.salaryPeriod ?? 'YEAR',
    industries: saved?.industries ?? [],
    preferredCompanies: saved?.preferredCompanies ?? [],
    excludedCompanies: saved?.excludedCompanies ?? [],
    noticePeriodDays: saved?.noticePeriodDays ?? null,
    keywords: saved?.keywords ?? [],
    maxPostingAgeDays: saved?.maxPostingAgeDays ?? 30,
    searchFrequency: saved?.searchFrequency ?? 'MANUAL',
    platforms: saved?.platforms ?? ['sandbox'],
    applicationMode: saved?.applicationMode ?? 'MANUAL',
    autoApplyMinScore: saved?.autoApplyMinScore ?? 75,
    dailyApplicationLimit: saved?.dailyApplicationLimit ?? 10,
    autoApplyConsent: !!saved?.autoApplyConsentAt,
    answerPreferences: {
      tone: saved?.answerPreferences?.tone ?? 'professional',
      maxLength: saved?.answerPreferences?.maxLength ?? 600,
      alwaysRequireApproval: saved?.answerPreferences?.alwaysRequireApproval ?? false,
      workAuthorizationCountries: saved?.answerPreferences?.workAuthorizationCountries ?? [],
      requiresSponsorship: saved?.answerPreferences?.requiresSponsorship ?? null,
      willingToRelocate: saved?.answerPreferences?.willingToRelocate ?? null,
      availableFrom: saved?.answerPreferences?.availableFrom ?? null,
    },
  };
}

export const TITLE_SUGGESTIONS = ['Software Developer', 'Software Engineer', 'Python Developer', 'Java Developer', 'Backend Developer', 'Full Stack Developer', 'Frontend Developer', 'Data Engineer', 'DevOps Engineer'];
const BANDS = [
  ['FRESHER', 'Fresher'],
  ['0-1', '0–1 years'],
  ['1-3', '1–3 years'],
  ['3-5', '3–5 years'],
  ['5-8', '5–8 years'],
  ['8+', '8+ years'],
  ['CUSTOM', 'Custom range'],
] as const;

type Section = 'titles' | 'experience' | 'locations' | 'salary' | 'more' | 'automation';
interface Props {
  value: PrefsDraft;
  onChange: (v: PrefsDraft) => void;
  sections?: Section[];
  features?: Record<string, boolean>;
}

const tri = (v: boolean | null) => (v == null ? '' : v ? 'yes' : 'no');
const fromTri = (s: string) => (s === '' ? null : s === 'yes');

export function PreferencesFields({ value: v, onChange, sections = ['titles', 'experience', 'locations', 'salary', 'more', 'automation'], features = {} }: Props) {
  const set = <K extends keyof PrefsDraft>(k: K, val: PrefsDraft[K]) => onChange({ ...v, [k]: val });
  const toggle = <T extends string>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((a) => a !== x) : [...arr, x]);
  const has = (s: Section) => sections.includes(s);
  return (
    <div className="space-y-6">
      {has('titles') && (
        <Card title="Target roles" description="Pick several — searches run for each title.">
          <ChipInput value={v.titles} onChange={(t) => set('titles', t)} placeholder="Type a title and press Enter" suggestions={TITLE_SUGGESTIONS} />
        </Card>
      )}
      {has('experience') && (
        <Card title="Experience level">
          <div className="flex flex-wrap gap-2">
            {BANDS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => set('experienceBand', k)} className={`rounded-lg border px-3 py-1.5 text-sm ${v.experienceBand === k ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                {label}
              </button>
            ))}
          </div>
          {v.experienceBand === 'CUSTOM' && (
            <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
              <Field label="Minimum years"><Input type="number" min={0} value={v.experienceMinYears ?? ''} onChange={(e) => set('experienceMinYears', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="Maximum years"><Input type="number" min={0} value={v.experienceMaxYears ?? ''} onChange={(e) => set('experienceMaxYears', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            </div>
          )}
        </Card>
      )}
      {has('locations') && (
        <Card title="Locations & work mode" actions={<Button size="sm" variant="outline" type="button" onClick={() => set('locations', [...v.locations, { city: '', state: '', country: '' }])}><Plus className="h-4 w-4" />Add location</Button>}>
          <div className="mb-4 flex flex-wrap gap-4">
            {WORK_MODES.map((m) => <Checkbox key={m} label={titleCase(m)} checked={v.workModes.includes(m)} onChange={() => set('workModes', toggle(v.workModes, m))} />)}
          </div>
          <div className="space-y-2">
            {v.locations.length === 0 && <p className="text-sm text-slate-500">Anywhere (no location filter).</p>}
            {v.locations.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-2">
                {(['city', 'state', 'country'] as const).map((k) => (
                  <Input key={k} placeholder={titleCase(k)} value={l[k] ?? ''} onChange={(e) => set('locations', v.locations.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                ))}
                <button aria-label="Remove location" type="button" className="text-slate-400 hover:text-rose-600" onClick={() => set('locations', v.locations.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {has('salary') && (
        <Card title="Salary expectations" description="Used for matching and to answer expected-salary questions.">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Minimum"><Input type="number" min={0} value={v.salaryMin ?? ''} onChange={(e) => set('salaryMin', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field label="Maximum"><Input type="number" min={0} value={v.salaryMax ?? ''} onChange={(e) => set('salaryMax', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field label="Currency"><Input maxLength={3} value={v.salaryCurrency} onChange={(e) => set('salaryCurrency', e.target.value.toUpperCase())} /></Field>
            <Field label="Period">
              <Select value={v.salaryPeriod} onChange={(e) => set('salaryPeriod', e.target.value as PrefsDraft['salaryPeriod'])}>
                <option value="YEAR">Per year</option><option value="MONTH">Per month</option><option value="HOUR">Per hour</option>
              </Select>
            </Field>
          </div>
        </Card>
      )}
      {has('more') && (
        <Card title="More preferences">
          <div className="grid gap-5 lg:grid-cols-2">
            <Field label="Employment types">
              <div className="flex flex-wrap gap-3 pt-1">{EMPLOYMENT_TYPES.map((t) => <Checkbox key={t} label={titleCase(t)} checked={v.employmentTypes.includes(t)} onChange={() => set('employmentTypes', toggle(v.employmentTypes, t))} />)}</div>
            </Field>
            <Field label="Platforms to search" hint="LinkedIn, Indeed and Naukri are user-assisted (via the extension).">
              <div className="flex flex-wrap gap-3 pt-1">{PLATFORM_KEYS.map((p) => <Checkbox key={p} label={titleCase(p)} checked={v.platforms.includes(p)} onChange={() => set('platforms', toggle(v.platforms, p))} />)}</div>
            </Field>
            <Field label="Keywords"><ChipInput value={v.keywords} onChange={(x) => set('keywords', x)} placeholder="e.g. fintech, microservices" /></Field>
            <Field label="Preferred industries"><ChipInput value={v.industries} onChange={(x) => set('industries', x)} /></Field>
            <Field label="Preferred companies"><ChipInput value={v.preferredCompanies} onChange={(x) => set('preferredCompanies', x)} /></Field>
            <Field label="Excluded companies" hint="Never shown as recommended or applied to"><ChipInput value={v.excludedCompanies} onChange={(x) => set('excludedCompanies', x)} /></Field>
            <Field label="Notice period (days)"><Input type="number" min={0} max={365} value={v.noticePeriodDays ?? ''} onChange={(e) => set('noticePeriodDays', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field label="Maximum job posting age (days)"><Input type="number" min={1} max={365} value={v.maxPostingAgeDays ?? ''} onChange={(e) => set('maxPostingAgeDays', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field label="Search frequency" hint={!features.scheduledSearch ? 'Scheduled searches require Basic or higher' : undefined}>
              <Select value={v.searchFrequency} onChange={(e) => set('searchFrequency', e.target.value as PrefsDraft['searchFrequency'])}>
                <option value="MANUAL">Manual only</option>
                <option value="DAILY" disabled={!features.scheduledSearch}>Daily</option>
                <option value="TWICE_DAILY" disabled={!features.scheduledSearch}>Twice daily</option>
                <option value="WEEKLY" disabled={!features.scheduledSearch}>Weekly</option>
              </Select>
            </Field>
          </div>
        </Card>
      )}
      {has('automation') && (
        <Card title="Applications & declarations" description="These facts are used to answer legal questions — they are always shown to you for confirmation before submission.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Countries you are authorized to work in"><ChipInput value={v.answerPreferences.workAuthorizationCountries} onChange={(x) => set('answerPreferences', { ...v.answerPreferences, workAuthorizationCountries: x })} placeholder="e.g. India" /></Field>
            <Field label="Do you require visa sponsorship?">
              <Select value={tri(v.answerPreferences.requiresSponsorship)} onChange={(e) => set('answerPreferences', { ...v.answerPreferences, requiresSponsorship: fromTri(e.target.value) })}>
                <option value="">Ask me each time</option><option value="no">No</option><option value="yes">Yes</option>
              </Select>
            </Field>
            <Field label="Willing to relocate?">
              <Select value={tri(v.answerPreferences.willingToRelocate)} onChange={(e) => set('answerPreferences', { ...v.answerPreferences, willingToRelocate: fromTri(e.target.value) })}>
                <option value="">Ask me each time</option><option value="yes">Yes</option><option value="no">No</option>
              </Select>
            </Field>
            <Field label="Answer tone">
              <Select value={v.answerPreferences.tone} onChange={(e) => set('answerPreferences', { ...v.answerPreferences, tone: e.target.value as 'professional' })}>
                <option value="professional">Professional</option><option value="concise">Concise</option><option value="enthusiastic">Enthusiastic</option>
              </Select>
            </Field>
          </div>
          <div className="mt-5 space-y-3">
            <Checkbox label="Always ask me to approve AI-written answers" checked={v.answerPreferences.alwaysRequireApproval} onChange={(x) => set('answerPreferences', { ...v.answerPreferences, alwaysRequireApproval: x })} />
            <Field label="Application mode">
              <Select value={v.applicationMode} onChange={(e) => set('applicationMode', e.target.value as PrefsDraft['applicationMode'])}>
                <option value="MANUAL">Manual — I approve every application</option>
                <option value="AUTOMATIC" disabled={!features.autoApply}>Automatic — submit eligible applications for me{!features.autoApply ? ' (Pro plan)' : ''}</option>
              </Select>
            </Field>
            {v.applicationMode === 'AUTOMATIC' && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
                <div className="grid max-w-md grid-cols-2 gap-3">
                  <Field label="Minimum match score"><Input type="number" min={0} max={100} value={v.autoApplyMinScore} onChange={(e) => set('autoApplyMinScore', Number(e.target.value))} /></Field>
                  <Field label="Max applications per day"><Input type="number" min={0} max={200} value={v.dailyApplicationLimit} onChange={(e) => set('dailyApplicationLimit', Number(e.target.value))} /></Field>
                </div>
                <Alert tone="warn">Automatic mode only submits on platforms that permit automation, and still stops for your approval whenever an answer is uncertain, sensitive or legally significant.</Alert>
                <Checkbox label="I consent to AutoApply submitting eligible applications on my behalf" description="You can turn this off at any time." checked={v.autoApplyConsent} onChange={(x) => set('autoApplyConsent', x)} />
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
