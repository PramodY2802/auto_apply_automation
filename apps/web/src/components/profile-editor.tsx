'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SKILL_CATEGORIES, type SkillCategory } from '@autoapply/shared';
import { put } from '@/lib/api';
import { cn, titleCase } from '@/lib/utils';
import { Badge, Button, Card, Checkbox, Field, Input, Select, Textarea, useToast } from './ui';

export interface ProfileData {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline?: string | null;
  summary: string | null;
  currentTitle: string | null;
  totalExperienceMonths: number | null;
  links: { linkedin?: string | null; github?: string | null; portfolio?: string | null; other?: string[] };
  fieldConfidence?: Record<string, number>;
  reviewedAt: string | null;
  experiences: { company: string | null; title: string | null; location: string | null; startDate: string | null; endDate: string | null; isCurrent: boolean; description: string | null; sourcePage?: number | null }[];
  education: { institution: string | null; degree: string | null; field: string | null; startDate: string | null; endDate: string | null; grade: string | null }[];
  skills: { name: string; category: SkillCategory; years: number | null }[];
  extras: { certifications: { name: string; issuer?: string | null; date?: string | null }[]; projects: { name: string; description?: string | null; technologies: string[]; url?: string | null }[]; achievements: string[] };
}

function Confidence({ v }: { v?: number }) {
  if (v == null) return null;
  const tone = v >= 0.8 ? 'green' : v >= 0.55 ? 'amber' : 'red';
  return <Badge tone={tone} className="ml-2">{v >= 0.8 ? 'High' : v >= 0.55 ? 'Check' : 'Low'} confidence</Badge>;
}

const dateOk = (s: string | null) => !s || /^(\d{4}(-(0[1-9]|1[0-2]))?|present)$/i.test(s);

export function ProfileEditor({ initial, onSaved, submitLabel = 'Save profile', reviewMode }: { initial: ProfileData; onSaved?: () => void; submitLabel?: string; reviewMode?: boolean }) {
  const [p, setP] = useState<ProfileData>(() => structuredClone(initial));
  const [newSkill, setNewSkill] = useState('');
  const [confirmed, setConfirmed] = useState(!reviewMode);
  const toast = useToast();
  const qc = useQueryClient();
  const conf = p.fieldConfidence ?? {};
  const years = p.totalExperienceMonths != null ? Math.round((p.totalExperienceMonths / 12) * 10) / 10 : '';
  const set = <K extends keyof ProfileData>(k: K, v: ProfileData[K]) => setP((x) => ({ ...x, [k]: v }));
  const badDates = p.experiences.some((e) => !dateOk(e.startDate) || !dateOk(e.endDate)) || p.education.some((e) => !dateOk(e.startDate) || !dateOk(e.endDate));

  const save = useMutation({
    mutationFn: () =>
      put('/profile', {
        fullName: p.fullName || null,
        email: p.email || null,
        phone: p.phone || null,
        location: p.location || null,
        summary: p.summary || null,
        currentTitle: p.currentTitle || null,
        totalExperienceMonths: p.totalExperienceMonths,
        links: { linkedin: p.links.linkedin || null, github: p.links.github || null, portfolio: p.links.portfolio || null, other: p.links.other ?? [] },
        experiences: p.experiences.map((e) => ({ ...e, startDate: e.startDate || null, endDate: e.isCurrent ? 'present' : e.endDate || null })),
        education: p.education.map((e) => ({ ...e, startDate: e.startDate || null, endDate: e.endDate || null })),
        skills: p.skills,
        certifications: p.extras.certifications,
        projects: p.extras.projects,
        achievements: p.extras.achievements,
        markReviewed: true,
      }),
    onSuccess: () => {
      toast({ tone: 'success', message: 'Profile saved' });
      void qc.invalidateQueries({ queryKey: ['profile'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      onSaved?.();
    },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });

  return (
    <div className="space-y-6">
      <Card title="Personal details" description="Fields marked low confidence came from OCR or ambiguous text — please check them.">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['fullName', 'Full name'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['location', 'Location'],
              ['currentTitle', 'Current title'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={<>{label}<Confidence v={conf[k]} /></>} htmlFor={k}>
              <Input id={k} value={(p[k] as string | null) ?? ''} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
          <Field label={<>Total experience (years)<Confidence v={conf.totalExperienceMonths} /></>} htmlFor="years" hint="Computed from your work history dates">
            <Input id="years" type="number" min={0} step={0.5} value={years} onChange={(e) => set('totalExperienceMonths', e.target.value === '' ? null : Math.round(Number(e.target.value) * 12))} />
          </Field>
          <Field label="LinkedIn" htmlFor="linkedin"><Input id="linkedin" value={p.links.linkedin ?? ''} onChange={(e) => set('links', { ...p.links, linkedin: e.target.value })} /></Field>
          <Field label="GitHub" htmlFor="github"><Input id="github" value={p.links.github ?? ''} onChange={(e) => set('links', { ...p.links, github: e.target.value })} /></Field>
          <Field label="Portfolio" htmlFor="portfolio"><Input id="portfolio" value={p.links.portfolio ?? ''} onChange={(e) => set('links', { ...p.links, portfolio: e.target.value })} /></Field>
        </div>
        <Field className="mt-4" label={<>Professional summary<Confidence v={conf.summary} /></>} htmlFor="summary" hint="Only copied from your resume — we never write one for you.">
          <Textarea id="summary" value={p.summary ?? ''} onChange={(e) => set('summary', e.target.value)} />
        </Field>
      </Card>

      <Card title="Work experience" actions={<Button size="sm" variant="outline" onClick={() => set('experiences', [...p.experiences, { company: '', title: '', location: null, startDate: '', endDate: '', isCurrent: false, description: '' }])}><Plus className="h-4 w-4" />Add</Button>}>
        {p.experiences.length === 0 && <p className="text-sm text-slate-500">No experience entries.</p>}
        <div className="space-y-4">
          {p.experiences.map((e, i) => {
            const upd = (patch: Partial<typeof e>) => set('experiences', p.experiences.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Role {i + 1}{e.sourcePage ? ` · page ${e.sourcePage}` : ''}<Confidence v={conf[`experiences.${i}`]} /></span>
                  <button aria-label="Remove role" className="text-slate-400 hover:text-rose-600" onClick={() => set('experiences', p.experiences.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Title"><Input value={e.title ?? ''} onChange={(ev) => upd({ title: ev.target.value })} /></Field>
                  <Field label="Company"><Input value={e.company ?? ''} onChange={(ev) => upd({ company: ev.target.value })} /></Field>
                  <Field label="Start (YYYY-MM)" error={dateOk(e.startDate) ? undefined : 'Use YYYY or YYYY-MM'}><Input value={e.startDate ?? ''} onChange={(ev) => upd({ startDate: ev.target.value })} placeholder="2021-01" /></Field>
                  <Field label="End (YYYY-MM)" error={dateOk(e.endDate) ? undefined : 'Use YYYY or YYYY-MM'}>
                    <Input value={e.isCurrent ? 'present' : (e.endDate ?? '')} disabled={e.isCurrent} onChange={(ev) => upd({ endDate: ev.target.value })} placeholder="2023-06" />
                  </Field>
                </div>
                <div className="mt-3"><Checkbox label="I currently work here" checked={e.isCurrent} onChange={(v) => upd({ isCurrent: v, endDate: v ? 'present' : '' })} /></div>
                <Field className="mt-3" label="Highlights"><Textarea value={e.description ?? ''} onChange={(ev) => upd({ description: ev.target.value })} /></Field>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title={<>Skills<Confidence v={conf.skills} /></>} description="Add years where you know them — they are used to answer “years of experience with X” questions truthfully.">
        <div className="space-y-2">
          {p.skills.map((s, i) => (
            <div key={s.name} className="grid grid-cols-[1fr_10rem_6rem_2rem] items-center gap-2">
              <span className="text-sm font-medium text-slate-800">{s.name}</span>
              <Select value={s.category} onChange={(e) => set('skills', p.skills.map((x, j) => (j === i ? { ...x, category: e.target.value as SkillCategory } : x)))}>
                {SKILL_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
              </Select>
              <Input type="number" min={0} max={60} placeholder="Years" value={s.years ?? ''} onChange={(e) => set('skills', p.skills.map((x, j) => (j === i ? { ...x, years: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
              <button aria-label={`Remove ${s.name}`} className="text-slate-400 hover:text-rose-600" onClick={() => set('skills', p.skills.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newSkill.trim() && !p.skills.some((s) => s.name.toLowerCase() === newSkill.trim().toLowerCase())) set('skills', [...p.skills, { name: newSkill.trim(), category: 'TECHNICAL', years: null }]); setNewSkill(''); }}>
          <Input placeholder="Add a skill" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} />
          <Button type="submit" variant="outline">Add</Button>
        </form>
      </Card>

      <Card title="Education" actions={<Button size="sm" variant="outline" onClick={() => set('education', [...p.education, { institution: '', degree: '', field: '', startDate: '', endDate: '', grade: null }])}><Plus className="h-4 w-4" />Add</Button>}>
        <div className="space-y-3">
          {p.education.length === 0 && <p className="text-sm text-slate-500">No education entries.</p>}
          {p.education.map((e, i) => {
            const upd = (patch: Partial<typeof e>) => set('education', p.education.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-[1fr_1fr_1fr_6rem_2rem]">
                <Field label="Institution"><Input value={e.institution ?? ''} onChange={(ev) => upd({ institution: ev.target.value })} /></Field>
                <Field label="Degree"><Input value={e.degree ?? ''} onChange={(ev) => upd({ degree: ev.target.value })} /></Field>
                <Field label="Field"><Input value={e.field ?? ''} onChange={(ev) => upd({ field: ev.target.value })} /></Field>
                <Field label="End year"><Input value={e.endDate ?? ''} onChange={(ev) => upd({ endDate: ev.target.value })} /></Field>
                <button aria-label="Remove education" className="mt-6 text-slate-400 hover:text-rose-600" onClick={() => set('education', p.education.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Certifications">
          <ul className="space-y-2">
            {p.extras.certifications.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input value={c.name} onChange={(e) => set('extras', { ...p.extras, certifications: p.extras.certifications.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <button aria-label="Remove certification" className="text-slate-400 hover:text-rose-600" onClick={() => set('extras', { ...p.extras, certifications: p.extras.certifications.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => set('extras', { ...p.extras, certifications: [...p.extras.certifications, { name: '' }] })}><Plus className="h-4 w-4" />Add certification</Button>
        </Card>
        <Card title="Projects">
          <ul className="space-y-2">
            {p.extras.projects.map((pr, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input value={pr.name} onChange={(e) => set('extras', { ...p.extras, projects: p.extras.projects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <button aria-label="Remove project" className="text-slate-400 hover:text-rose-600" onClick={() => set('extras', { ...p.extras, projects: p.extras.projects.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => set('extras', { ...p.extras, projects: [...p.extras.projects, { name: '', technologies: [] }] })}><Plus className="h-4 w-4" />Add project</Button>
        </Card>
      </div>

      <div className={cn('sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg')}>
        {reviewMode ? <Checkbox label="I have reviewed these details and they are accurate" checked={confirmed} onChange={setConfirmed} /> : <span className="text-sm text-slate-500">{p.reviewedAt ? 'Profile reviewed' : 'Not yet reviewed'}</span>}
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!confirmed || badDates || p.extras.certifications.some((c) => !c.name.trim()) || p.extras.projects.some((x) => !x.name.trim())}>{submitLabel}</Button>
      </div>
    </div>
  );
}
