'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Briefcase, Building2, ClipboardList, Gauge, LayoutDashboard, LogOut, Menu, Plug, Settings, SlidersHorizontal, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { get, post } from '@/lib/api';
import { ago, cn } from '@/lib/utils';
import { useLogout, useMe } from './providers';
import { Button, Spinner } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase, perm: 'jobs:read' },
  { href: '/applications', label: 'Applications', icon: ClipboardList, perm: 'applications:manage' },
  { href: '/profile', label: 'Profile & resumes', icon: UserRound, perm: 'profile:manage' },
  { href: '/preferences', label: 'Preferences', icon: SlidersHorizontal, perm: 'profile:manage' },
  { href: '/platforms', label: 'Platforms', icon: Plug, perm: 'platforms:connect' },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/enterprise', label: 'Enterprise', icon: Building2, perm: 'enterprise:read' },
  { href: '/admin', label: 'Admin', icon: Gauge, perm: 'admin:system:read' },
];

function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ items: any[]; unread: number }>('/notifications?limit=15'), refetchInterval: 30_000 });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const link = (n: any) => (n.data?.applicationId ? `/applications/${n.data.applicationId}` : n.data?.resumeId ? '/profile' : n.data?.runId ? '/jobs?view=NEW' : '/dashboard');
  return (
    <div className="relative">
      <button aria-label="Notifications" onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100">
        <Bell className="h-5 w-5" />
        {!!data?.unread && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            <button className="text-xs text-brand-700 hover:underline" onClick={() => readAll.mutate()}>Mark all read</button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!data?.items.length && <li className="px-4 py-6 text-center text-sm text-slate-500">You're all caught up.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <Link href={link(n)} onClick={() => { setOpen(false); void post(`/notifications/${n.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['notifications'] })); }} className={cn('block border-b border-slate-50 px-4 py-3 hover:bg-slate-50', !n.readAt && 'bg-brand-50/40')}>
                  <div className="flex justify-between gap-2 text-sm font-medium text-slate-900">{n.title}<span className="shrink-0 text-xs font-normal text-slate-400">{ago(n.createdAt)}</span></div>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  const router = useRouter();
  const path = usePathname();
  const logout = useLogout();
  const [mobile, setMobile] = useState(false);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (!isLoading && me === null) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [isLoading, me, router, path]);
  useEffect(() => setMobile(false), [path]);
  if (isLoading || !me) return <Spinner />;
  const items = NAV.filter((n) => (!n.perm || me.permissions.includes(n.perm)) && (n.href !== '/enterprise' || !!me.enterprise));
  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {items.map((n) => {
        const active = path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link key={n.href} href={n.href} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors', active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
            <n.icon className="h-4 w-4" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
  const footer = (
    <div className="border-t border-slate-200 p-3">
      <div className="px-3 pb-2">
        <div className="truncate text-sm font-medium text-slate-900">{me.user.fullName}</div>
        <div className="truncate text-xs text-slate-500">{me.enterprise ? `${me.enterprise.name} · ` : ''}{me.plan.name} plan</div>
      </div>
      <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
        <LogOut className="h-4 w-4" /> Sign out
      </button>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <Link href="/dashboard" className="px-6 py-5 text-lg font-semibold text-slate-900">AutoApply</Link>
        {nav}
        {footer}
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white">
            <div className="flex items-center justify-between px-6 py-5">
              <span className="text-lg font-semibold">AutoApply</span>
              <button aria-label="Close menu" onClick={() => setMobile(false)}><X className="h-5 w-5" /></button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <button aria-label="Open menu" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setMobile(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden text-sm text-slate-500 lg:block">{me.user.platformRole !== 'USER' && <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">{me.user.platformRole.replace('_', ' ')}</span>}</div>
          <Notifications />
        </header>
        {!me.user.emailVerified && (
          <div className="flex flex-wrap items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Please verify your email address ({me.user.email}).
            <Button size="sm" variant="ghost" disabled={resent} onClick={async () => { await post('/auth/resend-verification'); setResent(true); }}>
              {resent ? 'Sent' : 'Resend link'}
            </Button>
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
