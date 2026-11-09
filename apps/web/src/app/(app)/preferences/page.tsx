'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { defaultPrefs, PreferencesFields, type PrefsDraft } from '@/components/preferences-form';
import { useMe } from '@/components/providers';
import { Alert, Button, PageHeader, Spinner, useToast } from '@/components/ui';
import { get, put } from '@/lib/api';

export default function PreferencesPage() {
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['preferences'], queryFn: () => get('/preferences') });
  const [v, setV] = useState<PrefsDraft | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    if (q.isSuccess && !v) setV(defaultPrefs(q.data));
  }, [q.isSuccess, q.data, v]);
  const save = useMutation({
    mutationFn: () => put('/preferences', v),
    onSuccess: () => {
      toast({ tone: 'success', message: 'Preferences saved — re-scoring your jobs' });
      void qc.invalidateQueries({ queryKey: ['preferences'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  if (!v) return <Spinner />;
  return (
    <>
      <PageHeader title="Job preferences" description="Matching, discovery and answers use these settings." actions={<Button loading={save.isPending} disabled={!v.titles.length} onClick={() => save.mutate()}>Save changes</Button>} />
      {save.error && <div className="mb-4"><Alert tone="error">{(save.error as Error).message}</Alert></div>}
      <PreferencesFields value={v} onChange={setV} features={me?.plan.features} />
      <div className="mt-6 flex justify-end"><Button loading={save.isPending} disabled={!v.titles.length} onClick={() => save.mutate()}>Save changes</Button></div>
    </>
  );
}
