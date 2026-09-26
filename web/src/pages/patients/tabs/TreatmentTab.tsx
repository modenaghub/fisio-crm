import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Target } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Select, Textarea, type BadgeTone } from '@/components/ui';
import type { PatientDetail } from '../PatientPage';
import { EVAL_TYPES, type Evaluation } from './EvaluationsTab';

interface Plan {
  id: string;
  objective: string;
  treatment: string;
  frequencyPerWeek: number | null;
  plannedSessions: number | null;
  startDate: string | null;
  expectedEndDate: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  observations: string | null;
  evaluationId: string | null;
  sessionsDone: number;
  createdAt: string;
}

const STATUS: Record<Plan['status'], [string, BadgeTone]> = { DRAFT: ['Rascunho', 'slate'], ACTIVE: ['Ativo', 'green'], COMPLETED: ['Concluído', 'blue'], CANCELLED: ['Cancelado', 'red'] };

function PlanModal({ patientId, initial, onClose }: { patientId: string; initial?: Plan; onClose: () => void }) {
  const qc = useQueryClient();
  const evals = useQuery({ queryKey: ['evaluations', patientId], queryFn: () => api<Evaluation[]>(`/patients/${patientId}/evaluations`) });
  const [v, setV] = useState({
    objective: initial?.objective ?? '', treatment: initial?.treatment ?? '', frequencyPerWeek: initial?.frequencyPerWeek ?? 2, plannedSessions: initial?.plannedSessions ?? 10,
    startDate: initial?.startDate ?? new Date().toISOString().slice(0, 10), expectedEndDate: initial?.expectedEndDate ?? '', observations: initial?.observations ?? '',
    evaluationId: initial?.evaluationId ?? '', status: initial?.status ?? 'ACTIVE',
  });
  const set = (k: keyof typeof v, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  // Previsão de término a partir de frequência e número de sessões.
  const suggestEnd = () => {
    if (!v.startDate || !v.frequencyPerWeek || !v.plannedSessions) return;
    const weeks = Math.ceil(Number(v.plannedSessions) / Number(v.frequencyPerWeek));
    const d = new Date(`${v.startDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + weeks * 7);
    set('expectedEndDate', d.toISOString().slice(0, 10));
  };
  const invalid = v.objective.trim().length < 3 || v.treatment.trim().length < 3 || (!!v.expectedEndDate && v.expectedEndDate < v.startDate);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, evaluationId: v.evaluationId || undefined, frequencyPerWeek: v.frequencyPerWeek || null, plannedSessions: v.plannedSessions || null };
      return initial ? api(`/patients/${patientId}/treatment-plans/${initial.id}`, { method: 'PATCH', body }) : api(`/patients/${patientId}/treatment-plans`, { method: 'POST', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plans', patientId] }); qc.invalidateQueries({ queryKey: ['patient', patientId] }); toast.success('Plano salvo'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} size="lg" title={initial ? 'Editar plano de tratamento' : 'Novo plano de tratamento'} description={initial ? undefined : 'Ao criar um plano ativo, o anterior é concluído automaticamente.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Salvar plano</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Objetivo" required className="sm:col-span-2"><Textarea rows={2} value={v.objective} onChange={(e) => set('objective', e.target.value)} placeholder="Ex.: reduzir a dor e recuperar a amplitude de flexão do ombro" /></Field>
        <Field label="Tratamento proposto" required className="sm:col-span-2"><Textarea rows={3} value={v.treatment} onChange={(e) => set('treatment', e.target.value)} placeholder="Condutas, técnicas e progressão" /></Field>
        <Field label="Frequência (vezes por semana)"><Input type="number" min={1} max={14} value={v.frequencyPerWeek ?? ''} onChange={(e) => set('frequencyPerWeek', Number(e.target.value))} onBlur={suggestEnd} /></Field>
        <Field label="Número de sessões"><Input type="number" min={1} max={500} value={v.plannedSessions ?? ''} onChange={(e) => set('plannedSessions', Number(e.target.value))} onBlur={suggestEnd} /></Field>
        <Field label="Início"><Input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} onBlur={suggestEnd} /></Field>
        <Field label="Previsão de término" hint="Calculada pela frequência; ajuste se precisar." error={v.expectedEndDate && v.expectedEndDate < v.startDate ? 'Deve ser depois do início' : undefined}>
          <Input type="date" value={v.expectedEndDate} onChange={(e) => set('expectedEndDate', e.target.value)} />
        </Field>
        <Field label="Baseado na avaliação">
          <Select value={v.evaluationId} onChange={(e) => set('evaluationId', e.target.value)}>
            <option value="">—</option>
            {evals.data?.map((e) => <option key={e.id} value={e.id}>{EVAL_TYPES[e.type]} de {formatDate(e.performedAt)}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={v.status} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Observações" className="sm:col-span-2"><Textarea rows={2} value={v.observations} onChange={(e) => set('observations', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function TreatmentTab({ patient }: { patient: PatientDetail }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['plans', patient.id], queryFn: () => api<Plan[]>(`/patients/${patient.id}/treatment-plans`) });
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  if (q.isLoading) return <Card><LoadingState rows={2} /></Card>;
  if (q.isError) return <Card><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></Card>;
  const plans = q.data ?? [];
  const active = plans.find((p) => p.status === 'ACTIVE');
  const others = plans.filter((p) => p !== active);
  return (
    <div className="space-y-4">
      {active ? (
        <Card>
          <CardHeader title="Plano de tratamento ativo" description={`Criado em ${formatDate(active.createdAt)}`}
            actions={can('clinical.write') && <><Button variant="outline" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(active)}>Editar</Button><Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo plano</Button></>} />
          <div className="space-y-5 p-5">
            <div className="flex gap-3"><Target className="mt-0.5 size-5 text-brand-700" /><div><p className="text-xs text-slate-500">Objetivo</p><p className="whitespace-pre-wrap text-sm font-medium text-slate-900">{active.objective}</p></div></div>
            <div><p className="text-xs text-slate-500">Tratamento</p><p className="whitespace-pre-wrap text-sm text-slate-800">{active.treatment}</p></div>
            <dl className="grid gap-4 sm:grid-cols-4">
              <div><dt className="text-xs text-slate-500">Frequência</dt><dd className="text-sm font-medium">{active.frequencyPerWeek ? `${active.frequencyPerWeek}× por semana` : '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Sessões</dt><dd className="text-sm font-medium tabular">{active.sessionsDone} de {active.plannedSessions ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Início</dt><dd className="text-sm font-medium">{formatDate(active.startDate)}</dd></div>
              <div><dt className="text-xs text-slate-500">Previsão de término</dt><dd className="text-sm font-medium">{formatDate(active.expectedEndDate)}</dd></div>
            </dl>
            {active.plannedSessions && (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.min(100, (active.sessionsDone / active.plannedSessions) * 100)}%` }} /></div>
                <p className="mt-1 text-xs text-slate-500">{Math.round(Math.min(100, (active.sessionsDone / active.plannedSessions) * 100))}% das sessões planejadas</p>
              </div>
            )}
            {active.observations && <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">{active.observations}</p>}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<Target className="size-6" />} title="Nenhum plano ativo" description="Defina objetivo, tratamento, frequência e número de sessões."
            action={can('clinical.write') && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Criar plano de tratamento</Button>} />
        </Card>
      )}
      {others.length > 0 && (
        <Card>
          <CardHeader title="Planos anteriores" />
          <ul className="divide-y divide-slate-100">
            {others.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{p.objective}</p>
                  <p className="text-xs text-slate-500">{formatDate(p.startDate)} · {p.sessionsDone} sessões</p>
                </div>
                <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
                {can('clinical.write') && <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>Abrir</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <PlanModal patientId={patient.id} initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
