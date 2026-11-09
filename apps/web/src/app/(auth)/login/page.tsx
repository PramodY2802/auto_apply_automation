'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginSchema, type LoginInput } from '@autoapply/shared';
import { Alert, Button, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/dashboard';
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await post('/auth/login', v);
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(next.startsWith('/') ? next : '/dashboard');
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <>
      <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
      <p className="mb-5 mt-1 text-sm text-slate-500">Welcome back.</p>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>Sign in</Button>
      </form>
      <div className="mt-5 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">Forgot password?</Link>
        <Link href="/signup" className="text-brand-700 hover:underline">Create account</Link>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
