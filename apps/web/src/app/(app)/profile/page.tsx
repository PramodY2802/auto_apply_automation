'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Star } from 'lucide-react';
import { useState } from 'react';
import { ProfileEditor } from '@/components/profile-editor';
import { ExtractionStatus, ResumeDropzone } from '@/components/resume-upload';
import { Badge, Button, Card, ConfirmButton, Dialog, PageHeader, Spinner, StatusBadge, Table, useToast } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { ago } from '@/lib/utils';

export default function ProfilePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => get('/profile') });
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => get<any[]>('/resumes'), refetchInterval: (q) => (q.state.data?.some((r: any) => ['UPLOADED', 'PROCESSING'].includes(r.status)) ? 2000 : false) });
  const [show, setShow] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['resumes'] });
    void qc.invalidateQueries({ queryKey: ['profile'] });
  };
  const apply = useMutation({ mutationFn: (id: string) => post(`/resumes/${id}/extraction/apply`), onSuccess: () => { toast({ tone: 'success', message: 'Profile replaced with this resume’s extraction — please review.' }); refresh(); } });
  return (
    <>
      <PageHeader title="Profile & resumes" description="Your verified candidate profile is the only source used for applications." actions={<Button onClick={() => setUploadOpen(true)}>Upload resume</Button>} />
      <Card className="mb-6" title="Resumes">
        {resumes.isLoading ? <Spinner /> : (
          <Table head={['File', 'Status', 'Uploaded', '']}>
            {resumes.data?.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{r.fileName} {r.isPrimary && <Badge tone="brand"><Star className="h-3 w-3" />Primary</Badge>}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-slate-500">{ago(r.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setShow(r.id)}>Extraction</Button>
                    <a className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100" href={`/api/v1/resumes/${r.id}/file`}><Download className="h-4 w-4" />Download</a>
                    {!r.isPrimary && <Button size="sm" variant="ghost" onClick={async () => { await post(`/resumes/${r.id}/primary`); refresh(); }}>Make primary</Button>}
                    <ConfirmButton size="sm" title="Delete resume?" message="The file and its extracted text will be permanently deleted." onConfirm={async () => { await del(`/resumes/${r.id}`); refresh(); }}>Delete</ConfirmButton>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {profile.isLoading ? <Spinner /> : profile.data && <ProfileEditor key={(profile.data as any).updatedAt ?? 'p'} initial={profile.data as any} />}
      <Dialog open={!!show} onClose={() => setShow(null)} title="Extraction details" wide footer={show && <Button variant="outline" loading={apply.isPending} onClick={() => apply.mutate(show)}>Replace profile with this extraction</Button>}>
        {show && <ExtractionStatus resumeId={show} />}
      </Dialog>
      <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload resume" wide>
        <ResumeDropzone onUploaded={(r) => { setUploadOpen(false); setShow(r.resumeId); refresh(); }} />
      </Dialog>
    </>
  );
}
