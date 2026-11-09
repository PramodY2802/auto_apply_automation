import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-white to-brand-50 px-4 py-10">
      <Link href="/" className="mb-6 text-xl font-semibold text-slate-900">AutoApply</Link>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">{children}</div>
    </main>
  );
}
