import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatRelative } from '@/lib/format';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Select, Switch, Textarea } from '@/components/ui';
import type { PatientDetail } from '../PatientPage';

interface Profile {
  mainComplaint: string | null;
  diagnosis: string | null;
  medicalHistory: string | null;
  medications: string | null;
  allergies: string | null;
  contraindications: string | null;
  observations: string | null;
  updatedAt: string | null;
}
interface Condition {
  id: string;
  type: string;
  description: string;
  icd10Code: string | null;
  bodyRegion: string | null;
  laterality: string | null;
  since: string | null;
  isActive: boolean;
  notes: string | null;
}

export const CONDITION_TYPES: Record<string, string> = {
  DISEASE: 'Doença', INJURY: 'Lesão', PATHOLOGY: 'Patologia', SURGERY: 'Cirurgia', MEDICATION: 'Medicamento', ALLERGY: 'Alergia', OTHER: 'Outro',
};

const PROFILE_FIELDS: [keyof Profile, string, number][] = [
  ['mainComplaint', 'Queixa principal', 2],
  ['diagnosis', 'Diagnóstico', 2],
  ['medicalHistory', 'Histórico médico', 4],
  ['medications', 'Medicamentos em uso', 2],
  ['allergies', 'Alergias', 2],
  ['contraindications', 'Contraindicações', 2],
  ['observations', 'Observações clínicas', 3],
];

function ConditionModal({ patientId, initial, onClose }: { patientId: string; initial?: Condition; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    type: initial?.type ?? 'INJURY', description: initial?.description ?? '', icd10Code: initial?.icd10Code ?? '', bodyRegion: initial?.bodyRegion ?? '',
    laterality: initial?.laterality ?? '', since: initial?.since ?? '', notes: initial?.notes ?? '', isActive: initial?.isActive ?? true,
  });
  const catalog = useQuery({
    queryKey: ['conditions-catalog', v.description],
    queryFn: () => api<{ id: string; name: string; type: string; icd10Code: string | null }[]>(`/clinical/conditions-catalog?q=${encodeURIComponent(v.description)}`),
    enabled: v.description.length >= 2 && !initial,
  });
  const save = useMutation({
    mutationFn: () => (initial ? api(`/patients/${patientId}/conditions/${initial.id}`, { method: 'PATCH', body: v }) : api(`/patients/${patientId}/conditions`, { method: 'POST', body: v })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clinical-profile', patientId] }); toast.success('Condição salva'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const set = (k: keyof typeof v, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  const suggestions = (catalog.data ?? []).filter((c) => c.name.toLowerCase() !== v.description.toLowerCase());
  return (
    <Modal open onClose={onClose} title={initial ? 'Editar condição' : 'Nova condição'} description="Doenças, lesões, patologias, cirurgias, medicamentos ou alergias." footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} disabled={v.description.trim().length < 2} onClick={() => save.mutate()}>Salvar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo">
          <Select value={v.type} onChange={(e) => set('type', e.target.value)}>
            {Object.entries(CONDITION_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="CID-10" hint="Opcional">
          <Input value={v.icd10Code} maxLength={8} placeholder="Ex.: M75.1" onChange={(e) => set('icd10Code', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Descrição" required className="sm:col-span-2">
          <Input autoFocus value={v.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex.: Lesão do manguito rotador" />
          {suggestions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.slice(0, 5).map((s) => (
                <button key={s.id} type="button" onClick={() => setV((x) => ({ ...x, description: s.name, type: s.type, icd10Code: s.icd10Code ?? x.icd10Code }))} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-brand-50">
                  {s.name}{s.icd10Code && ` · ${s.icd10Code}`}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Região do corpo"><Input value={v.bodyRegion} onChange={(e) => set('bodyRegion', e.target.value)} /></Field>
        <Field label="Lado">
          <Select value={v.laterality} onChange={(e) => set('laterality', e.target.value)}>
            <option value="">—</option><option value="direito">Direito</option><option value="esquerdo">Esquerdo</option><option value="bilateral">Bilateral</option>
          </Select>
        </Field>
        <Field label="Desde"><Input type="date" value={v.since} onChange={(e) => set('since', e.target.value)} /></Field>
        <div className="flex items-end justify-between rounded-lg border border-slate-200 px-3 py-2.5">
          <span className="text-sm text-slate-700">Condição ativa</span>
          <Switch checked={v.isActive} onChange={(b) => set('isActive', b)} label="Condição ativa" />
        </div>
        <Field label="Observações" className="sm:col-span-2"><Textarea rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function ClinicalTab({ patient }: { patient: PatientDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['clinical-profile', patient.id], queryFn: () => api<{ profile: Profile; conditions: Condition[] }>(`/patients/${patient.id}/clinical-profile`) });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Profile | null>(null);
  const [cond, setCond] = useState<Condition | 'new' | null>(null);
  const [removing, setRemoving] = useState<Condition | null>(null);
  useEffect(() => { if (q.data && !editing) setForm(q.data.profile); }, [q.data, editing]);
  const save = useMutation({
    mutationFn: () => api(`/patients/${patient.id}/clinical-profile`, { method: 'PUT', body: Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, form?.[k] ?? ''])) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clinical-profile', patient.id] }); setEditing(false); toast.success('Dados clínicos salvos'); },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (c: Condition) => api(`/patients/${patient.id}/conditions/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clinical-profile', patient.id] }); setRemoving(null); toast.success('Condição excluída'); },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <Card><LoadingState rows={3} /></Card>;
  if (q.isError || !q.data || !form) return <Card><ErrorState message={q.error?.message} onRetry={() => q.refetch()} /></Card>;
  const p = q.data.profile;
  const alerts = [p.allergies && `Alergias: ${p.allergies}`, p.contraindications && `Contraindicações: ${p.contraindications}`].filter(Boolean);

  return (
    <div className="space-y-6">
      {alerts.length > 0 && (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>{alerts.map((a) => <p key={a as string}>{a}</p>)}</div>
        </div>
      )}
      <Card>
        <CardHeader
          title="Dados clínicos"
          description={p.updatedAt ? `Atualizado ${formatRelative(p.updatedAt)}` : 'Ainda não preenchido'}
          actions={can('clinical.write') && !editing && <Button variant="outline" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>}
        />
        {editing ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {PROFILE_FIELDS.map(([k, label, rows]) => (
              <Field key={k} label={label} className={rows >= 3 ? 'sm:col-span-2' : ''}>
                <Textarea rows={rows} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </Field>
            ))}
            <div className="flex gap-2 sm:col-span-2">
              <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar dados clínicos</Button>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            {PROFILE_FIELDS.map(([k, label, rows]) => (
              <div key={k} className={rows >= 3 ? 'sm:col-span-2' : ''}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{p[k] || <span className="text-slate-400">—</span>}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Doenças, lesões e patologias"
          actions={can('clinical.write') && <Button variant="outline" size="sm" icon={<Plus className="size-4" />} onClick={() => setCond('new')}>Adicionar</Button>}
        />
        {q.data.conditions.length === 0 ? (
          <EmptyState title="Nenhuma condição registrada" description="Registre doenças, lesões, cirurgias, medicamentos e alergias do paciente." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {q.data.conditions.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    {c.description}
                    <Badge tone={c.type === 'ALLERGY' ? 'red' : c.type === 'SURGERY' ? 'violet' : 'slate'}>{CONDITION_TYPES[c.type]}</Badge>
                    {c.icd10Code && <span className="font-mono text-xs text-slate-500">{c.icd10Code}</span>}
                    {!c.isActive && <Badge>Inativa</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[c.bodyRegion, c.laterality, c.since && `desde ${formatDate(c.since)}`].filter(Boolean).join(' · ')}
                    {c.notes && ` — ${c.notes}`}
                  </p>
                </div>
                {can('clinical.write') && <Button variant="ghost" size="sm" onClick={() => setCond(c)}>Editar</Button>}
                {can('clinical.delete') && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setRemoving(c)}>Excluir</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {cond && <ConditionModal patientId={patient.id} initial={cond === 'new' ? undefined : cond} onClose={() => setCond(null)} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && del.mutate(removing)} loading={del.isPending} title="Excluir condição?" description="Prefira marcar como inativa para manter o histórico. A exclusão fica registrada na auditoria." confirmLabel="Excluir" />
    </div>
  );
}
