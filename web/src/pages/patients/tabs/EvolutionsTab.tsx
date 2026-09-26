import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownUp, FileText, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, plural } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal } from '@/components/ui';
import { EditEvolutionModal, EvolutionView, PainBadge, SessionFormModal, VersionsModal, type SessionRow } from '@/components/clinical';
import type { PatientDetail } from '../PatientPage';

export default function EvolutionsTab({ patient }: { patient: PatientDetail }) {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions', patient.id], queryFn: () => api<SessionRow[]>(`/patients/${patient.id}/sessions`) });
  const [newSession, setNewSession] = useState(false);
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [history, setHistory] = useState<SessionRow | null>(null);
  const [removing, setRemoving] = useState<SessionRow | null>(null);
  const [reason, setReason] = useState('');
  const [oldestFirst, setOldestFirst] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`/clinical/sessions/${removing!.id}`, { method: 'DELETE', body: { reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sessions'] }); qc.invalidateQueries({ queryKey: ['patient', patient.id] }); setRemoving(null); setReason(''); toast.success('Sessão excluída'); },
    onError: (e) => toast.error(e.message),
  });
  if (q.isLoading) return <Card><LoadingState rows={3} /></Card>;
  if (q.isError) return <Card><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></Card>;
  const list = [...(q.data ?? [])].sort((a, b) => (oldestFirst ? 1 : -1) * (new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime()));
  const canEdit = (s: SessionRow) => can('clinical.write') && (s.professional.id === me?.user.id || can('clinical.delete'));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{plural(list.filter((s) => !s.deleted).length, 'sessão registrada', 'sessões registradas')}</p>
        <div className="flex gap-2">
          {list.length > 1 && <Button variant="ghost" size="sm" icon={<ArrowDownUp className="size-4" />} onClick={() => setOldestFirst((o) => !o)}>{oldestFirst ? 'Mais antigas primeiro' : 'Mais recentes primeiro'}</Button>}
          {can('clinical.write') && <Button icon={<Plus className="size-4" />} onClick={() => setNewSession(true)}>Registrar atendimento</Button>}
        </div>
      </div>
      {list.length === 0 && <Card><EmptyState icon={<FileText className="size-6" />} title="Nenhuma sessão registrada" description="Cada atendimento registrado aparece aqui, em ordem cronológica." /></Card>}
      {list.map((s) => (
        <Card key={s.id} className={s.deleted ? 'opacity-70' : ''}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-5 py-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-800 tabular">{String(s.sessionNumber).padStart(2, '0')}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">Sessão {String(s.sessionNumber).padStart(2, '0')} {s.service && <span className="font-normal text-slate-500">· {s.service}</span>}</p>
              <p className="text-xs text-slate-500">{formatDateTime(s.performedAt)}{s.durationMinutes && ` · ${s.durationMinutes} min`} · {s.professional.name}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <PainBadge value={s.content?.painScale} />
              {s.package && <Badge tone="violet">{s.package}</Badge>}
              {s.version > 1 && <Badge tone="amber">Editada · v{s.version}</Badge>}
              {s.deleted && <Badge tone="red">Excluída</Badge>}
            </div>
          </div>
          <div className="px-5 py-4">
            {s.deleted ? <p className="text-sm text-slate-500">Registro excluído. Motivo: {s.deleteReason}</p> : s.content && <EvolutionView content={s.content} />}
          </div>
          {!s.deleted && (
            <div className="flex flex-wrap gap-1 border-t border-slate-100 px-3 py-2">
              {canEdit(s) && <Button variant="ghost" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(s)}>Editar</Button>}
              {s.version > 1 && <Button variant="ghost" size="sm" icon={<History className="size-4" />} onClick={() => setHistory(s)}>Ver versões</Button>}
              {can('clinical.delete') && <Button variant="ghost" size="sm" className="ml-auto text-red-600" icon={<Trash2 className="size-4" />} onClick={() => setRemoving(s)}>Excluir</Button>}
            </div>
          )}
        </Card>
      ))}
      {newSession && <SessionFormModal patient={patient} onClose={() => setNewSession(false)} />}
      {editing && <EditEvolutionModal session={editing} onClose={() => setEditing(null)} />}
      {history && <VersionsModal session={history} onClose={() => setHistory(null)} />}
      <Modal open={!!removing} onClose={() => setRemoving(null)} size="sm" title={`Excluir a sessão ${removing ? String(removing.sessionNumber).padStart(2, '0') : ''}?`}
        description="O conteúdo sai da ficha, mas continua guardado no banco com todas as versões. Se a sessão descontou de um pacote, o saldo é devolvido."
        footer={<><Button variant="outline" onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={del.isPending} onClick={() => del.mutate()}>Excluir sessão</Button></>}>
        <Field label="Motivo da exclusão" required><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: registro duplicado" /></Field>
      </Modal>
    </div>
  );
}
