'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Spinner } from '@/components/ui';
import { post } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token');
  const qc = useQueryClient();
  const [state, setState] = useState<'busy' | 'ok' | 'error'>('busy');
  const [msg, setMsg] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !token) return;
    ran.current = true;
    post('/auth/verify-email', { token })
      .then(() => {
        setState('ok');
        void qc.invalidateQueries({ queryKey: ['me'] });
      })
      .catch((e) => {
        setState('error');
        setMsg(e.message);
      });
  }, [token, qc]);
  if (!token) return <Alert tone="error">Missing verification token.</Alert>;
  if (state === 'busy') return <Spinner label="Verifying…" />;
  return state === 'ok' ? (
    <Alert tone="success" title="Email verified">Thanks! <Link href="/dashboard" className="underline">Continue to your dashboard</Link>.</Alert>
  ) : (
    <Alert tone="error" title="Verification failed">{msg}</Alert>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
