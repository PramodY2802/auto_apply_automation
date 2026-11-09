'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Reset your password</h1>
      {done ? (
        <Alert tone="success">If an account exists for {email}, we sent a reset link. It expires in one hour.</Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await post('/auth/password/forgot', { email }).catch(() => undefined);
            setBusy(false);
            setDone(true);
          }}
        >
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
      <Link href="/login" className="mt-5 block text-center text-sm text-brand-700 hover:underline">Back to sign in</Link>
    </>
  );
}
