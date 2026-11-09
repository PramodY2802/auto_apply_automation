'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Card, PageHeader } from '@/components/ui';
import { post } from '@/lib/api';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeader title="Join enterprise workspace" />
      <Card>
        <p className="mb-4 text-sm text-slate-600">Accepting moves your account into the enterprise. Its plan and AI configuration will apply to you, and enterprise admins will see your application activity.</p>
        {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
        <Button loading={busy} disabled={!token} onClick={async () => { setBusy(true); try { await post('/enterprise/invitations/accept', { token }); await qc.invalidateQueries(); router.replace('/dashboard'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Accept invitation</Button>
      </Card>
    </>
  );
}

export default function AcceptPage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
