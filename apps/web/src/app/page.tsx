'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { BrainCircuit, FileSearch, ScanText, ShieldCheck } from 'lucide-react';
import { useMe } from '@/components/providers';

export default function Landing() {
  const { data, isLoading } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (data) router.replace('/dashboard');
  }, [data, router]);
  if (isLoading || data) return null;
  const features = [
    { icon: ScanText, title: 'OCR + AI resume understanding', body: 'PDF, DOCX and scanned resumes become a structured, editable profile. Nothing is invented — every field is traced to your document.' },
    { icon: FileSearch, title: 'Discovery & explainable matching', body: 'Searches authorized sources on a schedule and ranks jobs with a transparent, deterministic score.' },
    { icon: BrainCircuit, title: 'Truthful application answers', body: 'Your choice of OpenAI, Anthropic or Gemini drafts answers from your real profile. Sensitive declarations always need your confirmation.' },
    { icon: ShieldCheck, title: 'Verified tracking', body: 'An application is only marked applied once a confirmation is observed or you confirm it yourself.' },
  ];
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-brand-50">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold text-slate-900">AutoApply</span>
        <div className="flex gap-3 text-sm">
          <Link href="/login" className="rounded-lg px-4 py-2 font-medium text-slate-700 hover:bg-white">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">Get started</Link>
        </div>
      </nav>
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Your job search, organised and automated — honestly.</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">Upload your resume, set your preferences, and let AutoApply find matching roles, prepare truthful applications and track every outcome in one place.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/signup" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow hover:bg-brand-700">Create your free account</Link>
          <Link href="/signup?type=enterprise" className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">For teams</Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <f.icon className="h-6 w-6 text-brand-600" />
            <h3 className="mt-3 text-sm font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
