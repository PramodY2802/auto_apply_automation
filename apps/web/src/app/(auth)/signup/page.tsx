'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { passwordSchema } from '@autoapply/shared';
import { Alert, Button, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { cn } from '@/lib/utils';

const schema = z
  .object({
    fullName: z.string().trim().min(1, 'Required'),
    email: z.string().trim().email(),
    password: passwordSchema,
    accountType: z.enum(['INDIVIDUAL', 'ENTERPRISE']),
    enterpriseName: z.string().optional(),
  })
  .refine((v) => v.accountType !== 'ENTERPRISE' || (v.enterpriseName?.trim().length ?? 0) >= 2, { path: ['enterpriseName'], message: 'Company name is required' });
type Form = z.infer<typeof schema>;

function SignupForm() {
  const params = useSearchParams();
  const invitation = params.get('invitation');
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { accountType: params.get('type') === 'enterprise' ? 'ENTERPRISE' : 'INDIVIDUAL', email: params.get('email') ?? '' },
  });
  const type = watch('accountType');
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await post('/auth/signup', { ...v, enterpriseName: v.accountType === 'ENTERPRISE' && !invitation ? v.enterpriseName : undefined, invitationToken: invitation ?? undefined });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(type === 'ENTERPRISE' && !invitation ? '/enterprise' : '/onboarding');
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <>
      <h1 className="text-lg font-semibold text-slate-900">{invitation ? 'Join your team' : 'Create your account'}</h1>
      <p className="mb-5 mt-1 text-sm text-slate-500">{invitation ? 'You were invited to an enterprise workspace.' : 'Free plan included. No card required.'}</p>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        {!invitation && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 text-sm">
            {(['INDIVIDUAL', 'ENTERPRISE'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setValue('accountType', t)} className={cn('rounded-md py-1.5 font-medium', type === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')}>
                {t === 'INDIVIDUAL' ? 'Individual' : 'Enterprise'}
              </button>
            ))}
          </div>
        )}
        <Field label="Full name" htmlFor="fullName" error={formState.errors.fullName?.message}>
          <Input id="fullName" autoComplete="name" {...register('fullName')} />
        </Field>
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" readOnly={!!invitation} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters with a letter and a number" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        {type === 'ENTERPRISE' && !invitation && (
          <Field label="Company / organisation name" htmlFor="enterpriseName" error={formState.errors.enterpriseName?.message}>
            <Input id="enterpriseName" {...register('enterpriseName')} />
          </Field>
        )}
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>Create account</Button>
        <p className="text-xs text-slate-500">By creating an account you agree to the terms and privacy policy. Resumes are stored encrypted at rest and can be deleted at any time.</p>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        Already have an account? <Link href="/login" className="text-brand-700 hover:underline">Sign in</Link>
      </p>
    </>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
