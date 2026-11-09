'use client';

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { ToastProvider } from './ui';

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

export interface Me {
  user: { id: string; email: string; fullName: string; platformRole: 'USER' | 'PLATFORM_ADMIN' | 'SUPER_ADMIN'; accountType: string; emailVerified: boolean };
  enterprise: { id: string; name: string; slug: string; role: 'ENTERPRISE_ADMIN' | 'ENTERPRISE_USER' } | null;
  permissions: string[];
  plan: { key: string; name: string; features: Record<string, boolean> };
  onboarding: { resumeUploaded: boolean; profileReviewed: boolean; preferencesSet: boolean };
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<Me>('/me');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useCan() {
  const { data } = useMe();
  return (p: string) => !!data?.permissions.includes(p);
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
}
