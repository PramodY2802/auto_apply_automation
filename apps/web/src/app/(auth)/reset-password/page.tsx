'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (state === 'done') return <Alert tone="success" title="Password updated">You can now <Link className="underline" href="/login">sign in</Link>. Other sessions were signed out.</Alert>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setState('busy');
        setError(null);
        try {
          await post('/auth/password/reset', { token, password });
          setState('done');
        } catch (err) {
          setError((err as Error).message);
          setState('idle');
        }
      }}
    >
      <h1 className="text-lg font-semibold text-slate-900">Choose a new password</h1>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="New password" htmlFor="pw" hint="At least 10 characters with a letter and a number">
        <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" className="w-full" loading={state === 'busy'} disabled={!token}>Update password</Button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
