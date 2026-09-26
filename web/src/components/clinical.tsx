import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { History } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, Select, Spinner, Textarea } from './ui';

// ───────────────────────── Escala de dor (EVA 0–10) ─────────────────────────

export function painColor(v: number | null | undefined) {
  if (v == null) return 'bg-slate-200 text-slate-600';
  if (v <= 3) return 'bg-emerald-100 text-emerald-800';
  if (v <= 6) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

export function PainBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular', painColor(value))}>Dor {value}/10</span>;
}

export function PainScaleInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Escala de dor de 0 a 10">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            onClick={() => onChange(value === i ? null : i)}
            className={clsx(
              'size-9 rounded-lg text-sm font-semibold tabular transition-colors',
              value === i ? (i <= 3 ? 'bg-emerald-600 text-white' : i <= 6 ? 'bg-amber-500 text-white' : 'bg-red-600 text-white') : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400"><span>Sem dor</span><span>Dor máxima</span></div>
    </div>
  );
}

// ───────────────────────── Evolução ─────────────────────────

export interface EvolutionContent {
  complaint: string | null;
  patientState: string | null;
  painScale: number | null;
  procedures: string | null;
  exercises: string | null;
  techniques: string | null;
  treatmentResponse: string | null;
  evolutionText: string;
  guidance: string | null;
  nextSteps: string | null;
}

export interface SessionRow {
  id: string;
  sessionNumber: number;
  performedAt: string;
  durationMinutes: number | null;
  professional: { id: string; name: string };
  patient: { id: string; name: string; photoUrl: string | null };
  service: string | null;
  package: string | null;
  deleted: boolean;
  deleteReason: string | null;
  version: number;
  lastEditedBy: { id: string; name: string } | null;
  lastEditedAt: string | null;
  content: EvolutionContent | null;
}

export const EVOLUTION_LABELS: [keyof EvolutionContent, string][] = [
  ['complaint', 'Queixa'],
  ['patientState', 'Estado do paciente'],
  ['procedures', 'Procedimentos realizados'],
  ['exercises', 'Exercícios realizados'],
  ['techniques', 'Técnicas utilizadas'],
  ['treatmentResponse', 'Resposta ao tratamento'],
  ['guidance', 'Orientações'],
  ['nextSteps', 'Próximos passos'],
];

export function EvolutionView({ content }: { content: EvolutionContent }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Evolução / Observações do atendimento</p>
        <p className="mt-1 whitespace-pre-wrap text-slate-800">{content.evolutionText}</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {EVOLUTION_LABELS.filter(([k]) => content[k]).map(([k, label]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="whitespace-pre-wrap text-slate-700">{String(content[k])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const emptyEvolution: EvolutionContent = {
  complaint: '', patientState: '', painScale: null, procedures: '', exercises: '', techniques: '', treatmentResponse: '', evolutionText: '', guidance: '', nextSteps: '',
};

function EvolutionFields({ v, set, showErrors }: { v: EvolutionContent; set: (k: keyof EvolutionContent, val: unknown) => void; showErrors: boolean }) {
  const short = v.evolutionText.trim().length < 10;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Queixa do dia">
          <Input value={v.complaint ?? ''} onChange={(e) => set('complaint', e.target.value)} />
        </Field>
        <Field label="Estado do paciente">
          <Input placeholder="Ex.: chegou com menos dor, disposto" value={v.patientState ?? ''} onChange={(e) => set('patientState', e.target.value)} />
        </Field>
      </div>
      <Field label="Dor (EVA)">
        <PainScaleInput value={v.painScale} onChange={(n) => set('painScale', n)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Procedimentos realizados"><Textarea rows={3} value={v.procedures ?? ''} onChange={(e) => set('procedures', e.target.value)} /></Field>
        <Field label="Exercícios realizados"><Textarea rows={3} value={v.exercises ?? ''} onChange={(e) => set('exercises', e.target.value)} /></Field>
        <Field label="Técnicas utilizadas"><Textarea rows={3} value={v.techniques ?? ''} onChange={(e) => set('techniques', e.target.value)} /></Field>
      </div>
      <Field label="Resposta ao tratamento">
        <Input value={v.treatmentResponse ?? ''} onChange={(e) => set('treatmentResponse', e.target.value)} />
      </Field>
      <Field label="Evolução / Observações do atendimento" required error={showErrors && short ? 'Descreva como foi a sessão (mínimo de 10 caracteres)' : undefined}>
        <Textarea
          rows={7}
          className="min-h-40 text-[15px] leading-relaxed"
          placeholder="Ex.: Paciente apresentou melhora da mobilidade do ombro direito. Relatou redução da dor após aplicação das técnicas. Realizados exercícios de mobilidade e fortalecimento…"
          value={v.evolutionText}
          onChange={(e) => set('evolutionText', e.target.value)}
          invalid={showErrors && short}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Orientações ao paciente"><Textarea rows={2} value={v.guidance ?? ''} onChange={(e) => set('guidance', e.target.value)} /></Field>
        <Field label="Próximos passos"><Textarea rows={2} value={v.nextSteps ?? ''} onChange={(e) => set('nextSteps', e.target.value)} /></Field>
      </div>
    </div>
  );
}

/** Registrar atendimento (nova sessão) — usado na ficha, em Atendimentos e na Agenda. */
export function SessionFormModal({
  patient,
  appointment,
  onClose,
  onSaved,
}: {
  patient: { id: string; name: string };
  appointment?: { id: string; startsAt: string; service?: string | null } | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState<EvolutionContent>(emptyEvolution);
  const [performedAt, setPerformedAt] = useState(() => {
    const d = appointment ? new Date(appointment.startsAt) : new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [duration, setDuration] = useState(50);
  const [skipBilling, setSkipBilling] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof EvolutionContent, val: unknown) => setV((s) => ({ ...s, [k]: val }));

  const save = useMutation({
    mutationFn: () =>
      api<{ sessionNumber: number; billing: { packageId: string | null; remaining: number | null; paymentId: string | null } }>(`/patients/${patient.id}/sessions`, {
        method: 'POST',
        body: { ...v, appointmentId: appointment?.id, performedAt: new Date(performedAt).toISOString(), durationMinutes: duration, skipBilling },
      }),
    onSuccess: (r) => {
      for (const k of [['patient', patient.id], ['sessions'], ['agenda'], ['clinical-overview'], ['finance'], ['dashboard'], ['crm-board']]) qc.invalidateQueries({ queryKey: k });
      toast.success(
        `Sessão ${String(r.sessionNumber).padStart(2, '0')} registrada` +
          (r.billing.packageId ? ` · pacote: ${r.billing.remaining} restante(s)` : r.billing.paymentId ? ' · cobrança gerada' : ''),
      );
      onSaved?.();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Registrar atendimento — ${patient.name}`}
      description={appointment ? `Agendamento de ${formatDateTime(appointment.startsAt)}${appointment.service ? ` · ${appointment.service}` : ''}` : 'Atendimento sem agendamento'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setSubmitted(true);
              if (v.evolutionText.trim().length >= 10) save.mutate();
            }}
          >
            Salvar atendimento
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Data e horário">
            <Input type="datetime-local" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
          </Field>
          <Field label="Duração">
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[20, 30, 40, 45, 50, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} minutos</option>)}
            </Select>
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox checked={skipBilling} onChange={setSkipBilling} label="Sem cobrança" description="Não desconta do pacote" />
          </div>
        </div>
        <EvolutionFields v={v} set={set} showErrors={submitted} />
        <Alert tone="blue">
          Ao salvar: a sessão é numerada, o agendamento vira "Realizado", o pacote é descontado (ou a cobrança é gerada) e o registro entra no histórico permanente.
        </Alert>
      </div>
    </Modal>
  );
}

export function EditEvolutionModal({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<EvolutionContent>({ ...emptyEvolution, ...(session.content ?? {}) });
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () => api(`/clinical/sessions/${session.id}/evolution`, { method: 'PATCH', body: { ...v, editReason: reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Evolução atualizada — a versão anterior foi preservada');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const set = (k: keyof EvolutionContent, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Editar sessão ${String(session.sessionNumber).padStart(2, '0')}`}
      description="O texto atual não é apagado: a alteração vira uma nova versão, com autor, data e motivo."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button loading={save.isPending} onClick={() => { setSubmitted(true); if (reason.trim().length >= 5 && v.evolutionText.trim().length >= 10) save.mutate(); }}>Salvar nova versão</Button>
        </>
      }
    >
      <div className="space-y-5">
        <EvolutionFields v={v} set={set} showErrors={submitted} />
        <Field label="Motivo da alteração" required error={submitted && reason.trim().length < 5 ? 'Informe o motivo' : undefined}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: complemento de informação, correção de digitação" />
        </Field>
      </div>
    </Modal>
  );
}

interface Version extends EvolutionContent {
  id: string;
  version: number;
  editReason: string | null;
  createdAt: string;
  author: { id: string; name: string };
}

export function VersionsModal({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const q = useQuery({ queryKey: ['versions', session.id], queryFn: () => api<Version[]>(`/clinical/sessions/${session.id}/versions`) });
  return (
    <Modal open onClose={onClose} size="lg" title={`Histórico da sessão ${String(session.sessionNumber).padStart(2, '0')}`} description="Todas as versões ficam guardadas e não podem ser alteradas.">
      {q.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
      <ol className="space-y-4">
        {q.data?.map((ver, i) => (
          <li key={ver.id} className="rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <History className="size-4 text-slate-400" />
              <span className="font-semibold text-slate-900">Versão {ver.version}</span>
              {i === 0 && <Badge tone="green">Atual</Badge>}
              <span className="text-slate-500">· {ver.author.name} · {formatDateTime(ver.createdAt)}</span>
            </div>
            {ver.editReason && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Motivo: {ver.editReason}</p>}
            <EvolutionView content={ver} />
          </li>
        ))}
      </ol>
    </Modal>
  );
}
