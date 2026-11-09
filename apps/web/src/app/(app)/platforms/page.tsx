'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { INTEGRATION_OPERATIONS } from '@autoapply/shared';
import { Alert, Button, Card, ChipInput, ConfirmButton, PageHeader, Spinner, StatusBadge, useToast } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { ago, titleCase } from '@/lib/utils';

function PlatformCard({ p }: { p: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const listKey = p.key === 'greenhouse' ? 'boards' : p.key === 'lever' ? 'sites' : null;
  const [list, setList] = useState<string[]>((p.connection?.settings?.[listKey ?? ''] as string[]) ?? []);
  const connect = useMutation({
    mutationFn: () => post<any>(`/platforms/${p.key}/connect`, { settings: listKey ? { [listKey]: list } : {} }),
    onSuccess: (r) => { toast({ tone: r.status === 'CONNECTED' ? 'success' : 'info', message: r.message }); void qc.invalidateQueries({ queryKey: ['platforms'] }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const status = p.connection?.status ?? 'DISCONNECTED';
  return (
    <Card title={<span className="flex items-center gap-2">{p.name} <StatusBadge status={status} /></span>} description={p.connection?.lastValidatedAt ? `Checked ${ago(p.connection.lastValidatedAt)}` : undefined}
      actions={p.connection && status !== 'DISCONNECTED' && <ConfirmButton size="sm" title={`Disconnect ${p.name}?`} message="Stored settings and any browser session for this platform are deleted." onConfirm={async () => { await del(`/platforms/${p.key}`); await qc.invalidateQueries({ queryKey: ['platforms'] }); }}>Disconnect</ConfirmButton>}>
      <table className="w-full text-sm">
        <tbody>
          {INTEGRATION_OPERATIONS.map((op) => (
            <tr key={op} className="border-b border-slate-50 last:border-0">
              <td className="py-1.5 pr-3 text-slate-600">{titleCase(op.replace(/([A-Z])/g, '_$1'))}</td>
              <td className="py-1.5"><StatusBadge status={p.capabilities[op].status} /></td>
              <td className="hidden py-1.5 pl-3 text-xs text-slate-500 md:table-cell">{p.capabilities[op].note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 space-y-3">
        {listKey && <ChipInput value={list} onChange={setList} placeholder={p.key === 'greenhouse' ? 'Board token, e.g. acme (boards.greenhouse.io/acme)' : 'Site name, e.g. acme (jobs.lever.co/acme)'} />}
        {p.capabilities.authenticate.status === 'USER_ASSISTED' && <Alert tone="info">Sign in to {p.name} yourself in your browser and connect via the AutoApply extension. Your password and MFA never pass through AutoApply.</Alert>}
        {p.connection?.lastError && <Alert tone="error">{p.connection.lastError}</Alert>}
        <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>{status === 'CONNECTED' ? 'Re-validate' : 'Connect'}</Button>
      </div>
    </Card>
  );
}

export default function PlatformsPage() {
  const q = useQuery({ queryKey: ['platforms'], queryFn: () => get<any[]>('/platforms') });
  return (
    <>
      <PageHeader title="Platforms" description="What each integration can and cannot do — shown honestly. Unsupported operations are never faked." />
      <Alert tone="info" title="Legend">
        <strong>Implemented</strong> = automated and tested · <strong>User assisted</strong> = you perform the step (the extension helps) · <strong>Unsupported</strong> = not permitted / awaiting platform authorization · <strong>Awaiting credentials</strong> = built, needs configuration.
      </Alert>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">{q.isLoading ? <Spinner /> : q.data?.map((p) => <PlatformCard key={p.key} p={p} />)}</div>
    </>
  );
}
