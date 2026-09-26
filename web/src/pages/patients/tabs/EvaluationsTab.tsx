import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { ChevronDown, ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Select, Textarea } from '@/components/ui';
import { PainBadge, PainScaleInput } from '@/components/clinical';
import type { PatientDetail } from '../PatientPage';

interface Rom { joint: string; movement: string; side?: string; degrees?: number | null; notes?: string }
interface Strength { muscle: string; side?: string; grade: number; notes?: string }
interface TestRow { name: string; result?: string; notes?: string }
interface Scale { name: string; score: string; interpretation?: string }
export interface Evaluation {
  id: string;
  type: 'INITIAL' | 'FOLLOW_UP' | 'DISCHARGE';
  performedAt: string;
  painScale: number | null;
  mainComplaint: string | null;
  mobility: string | null;
  posture: string | null;
  functionalAssessment: string | null;
  rangeOfMotion: Rom[];
  strength: Strength[];
  tests: TestRow[];
  scales: Scale[];
  otherParams: string | null;
  conclusion: string | null;
  professional: { id: string; name: string };
}

export const EVAL_TYPES = { INITIAL: 'Avaliação inicial', FOLLOW_UP: 'Reavaliação', DISCHARGE: 'Avaliação de alta' } as const;
const SIDES = [['', '—'], ['D', 'Direito'], ['E', 'Esquerdo'], ['B', 'Bilateral']];
const COMMON_TESTS = ['Jobe', 'Neer', 'Hawkins-Kennedy', 'Lachman', 'Gaveta anterior', 'McMurray', 'Lasègue', 'Phalen', 'Thomas', 'Trendelenburg'];
const COMMON_SCALES = ['EVA', 'DASH', 'Oswestry', 'Lysholm', 'WOMAC', 'Berg', 'SPADI', 'Roland-Morris'];

function RowsEditor<T extends object>({ title, rows, setRows, blank, columns }: {
  title: string;
  rows: T[];
  setRows: (r: T[]) => void;
  blank: T;
  columns: { key: keyof T; label: string; width: string; type?: 'text' | 'number' | 'side' | 'grade' | 'result'; list?: string[] }[];
}) {
  const update = (i: number, k: keyof T, val: unknown) => setRows(rows.map((r, idx) => (idx === i ? { ...r, [k]: val } : r)));
  const listId = `${title}-list`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <Button type="button" variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => setRows([...rows, { ...blank }])}>Linha</Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">Nenhum registro</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              {columns.map((c) => {
                const val = r[c.key] as unknown;
                const common = { 'aria-label': c.label, className: clsx('h-9 text-sm', c.width) };
                if (c.type === 'side') return <Select key={String(c.key)} {...common} value={(val as string) ?? ''} onChange={(e) => update(i, c.key, e.target.value)}>{SIDES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>;
                if (c.type === 'grade') return <Select key={String(c.key)} {...common} value={String(val ?? 5)} onChange={(e) => update(i, c.key, Number(e.target.value))}>{[0, 1, 2, 3, 4, 5].map((g) => <option key={g} value={g}>Grau {g}</option>)}</Select>;
                if (c.type === 'result') return <Select key={String(c.key)} {...common} value={(val as string) ?? ''} onChange={(e) => update(i, c.key, e.target.value)}><option value="">Resultado</option><option value="positivo">Positivo</option><option value="negativo">Negativo</option><option value="inconclusivo">Inconclusivo</option></Select>;
                if (c.type === 'number') return <Input key={String(c.key)} {...common} type="number" placeholder={c.label} value={val == null ? '' : String(val)} onChange={(e) => update(i, c.key, e.target.value === '' ? null : Number(e.target.value))} />;
                return <Input key={String(c.key)} {...common} placeholder={c.label} list={c.list ? listId : undefined} value={(val as string) ?? ''} onChange={(e) => update(i, c.key, e.target.value)} />;
              })}
              <button type="button" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover linha"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
      )}
      {columns.some((c) => c.list) && <datalist id={listId}>{columns.find((c) => c.list)!.list!.map((x) => <option key={x} value={x} />)}</datalist>}
    </div>
  );
}

function EvaluationModal({ patientId, initial, onClose, defaultType }: { patientId: string; initial?: Evaluation; onClose: () => void; defaultType: Evaluation['type'] }) {
  const qc = useQueryClient();
  const nowLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const [v, setV] = useState({
    type: initial?.type ?? defaultType,
    performedAt: initial ? new Date(new Date(initial.performedAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : nowLocal(),
    painScale: initial?.painScale ?? null as number | null,
    mainComplaint: initial?.mainComplaint ?? '', mobility: initial?.mobility ?? '', posture: initial?.posture ?? '', functionalAssessment: initial?.functionalAssessment ?? '',
    otherParams: initial?.otherParams ?? '', conclusion: initial?.conclusion ?? '',
  });
  const [rom, setRom] = useState<Rom[]>(initial?.rangeOfMotion ?? []);
  const [strength, setStrength] = useState<Strength[]>(initial?.strength ?? []);
  const [tests, setTests] = useState<TestRow[]>(initial?.tests ?? []);
  const [scales, setScales] = useState<Scale[]>(initial?.scales ?? []);
  const set = (k: keyof typeof v, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...v, performedAt: new Date(v.performedAt).toISOString(),
        rangeOfMotion: rom.filter((r) => r.joint && r.movement), strength: strength.filter((r) => r.muscle),
        tests: tests.filter((t) => t.name), scales: scales.filter((s) => s.name && s.score),
      };
      return initial ? api(`/patients/${patientId}/evaluations/${initial.id}`, { method: 'PATCH', body }) : api(`/patients/${patientId}/evaluations`, { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evaluations', patientId] });
      qc.invalidateQueries({ queryKey: ['patient', patientId] });
      toast.success('Avaliação salva');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} size="xl" title={initial ? 'Editar avaliação' : 'Nova avaliação'} footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar avaliação</Button></>}>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={v.type} onChange={(e) => set('type', e.target.value)}>
              {Object.entries(EVAL_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Data e horário"><Input type="datetime-local" value={v.performedAt} onChange={(e) => set('performedAt', e.target.value)} /></Field>
        </div>
        <Field label="Queixa principal"><Textarea rows={2} value={v.mainComplaint} onChange={(e) => set('mainComplaint', e.target.value)} /></Field>
        <Field label="Dor (EVA)"><PainScaleInput value={v.painScale} onChange={(n) => set('painScale', n)} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Mobilidade"><Textarea rows={3} value={v.mobility} onChange={(e) => set('mobility', e.target.value)} /></Field>
          <Field label="Postura"><Textarea rows={3} value={v.posture} onChange={(e) => set('posture', e.target.value)} /></Field>
          <Field label="Avaliação funcional"><Textarea rows={3} value={v.functionalAssessment} onChange={(e) => set('functionalAssessment', e.target.value)} /></Field>
        </div>
        <RowsEditor title="Amplitude de movimento (ADM)" rows={rom} setRows={setRom} blank={{ joint: '', movement: '', side: '', degrees: null }}
          columns={[{ key: 'joint', label: 'Articulação', width: 'w-32', list: ['Ombro', 'Cotovelo', 'Punho', 'Quadril', 'Joelho', 'Tornozelo', 'Coluna cervical', 'Coluna lombar'] }, { key: 'movement', label: 'Movimento', width: 'w-32' }, { key: 'side', label: 'Lado', width: 'w-28', type: 'side' }, { key: 'degrees', label: 'Graus', width: 'w-24', type: 'number' }]} />
        <RowsEditor title="Força muscular (0–5)" rows={strength} setRows={setStrength} blank={{ muscle: '', side: '', grade: 5 }}
          columns={[{ key: 'muscle', label: 'Músculo / grupo', width: 'w-48' }, { key: 'side', label: 'Lado', width: 'w-28', type: 'side' }, { key: 'grade', label: 'Grau', width: 'w-28', type: 'grade' }]} />
        <RowsEditor title="Testes especiais" rows={tests} setRows={setTests} blank={{ name: '', result: '' }}
          columns={[{ key: 'name', label: 'Teste', width: 'w-48', list: COMMON_TESTS }, { key: 'result', label: 'Resultado', width: 'w-36', type: 'result' }, { key: 'notes', label: 'Observação', width: 'w-48' }]} />
        <RowsEditor title="Escalas e questionários" rows={scales} setRows={setScales} blank={{ name: '', score: '' }}
          columns={[{ key: 'name', label: 'Escala', width: 'w-40', list: COMMON_SCALES }, { key: 'score', label: 'Pontuação', width: 'w-28' }, { key: 'interpretation', label: 'Interpretação', width: 'w-48' }]} />
        <Field label="Outros parâmetros"><Textarea rows={2} value={v.otherParams} onChange={(e) => set('otherParams', e.target.value)} /></Field>
        <Field label="Conclusão / impressão fisioterapêutica"><Textarea rows={3} value={v.conclusion} onChange={(e) => set('conclusion', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function EvaluationDetail({ e }: { e: Evaluation }) {
  const Table = ({ head, rows }: { head: string[]; rows: (string | number | null | undefined)[][] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500">{head.map((h) => <th key={h} className="py-1 pr-4 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="py-1.5 pr-4 text-slate-700">{c ?? '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
  const side = (s?: string) => ({ D: 'Dir.', E: 'Esq.', B: 'Bilat.' } as Record<string, string>)[s ?? ''] ?? '—';
  return (
    <div className="space-y-4 border-t border-slate-100 px-5 py-4">
      <dl className="grid gap-4 sm:grid-cols-3">
        {[['Queixa principal', e.mainComplaint], ['Mobilidade', e.mobility], ['Postura', e.posture], ['Avaliação funcional', e.functionalAssessment], ['Outros parâmetros', e.otherParams]].filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="whitespace-pre-wrap text-sm text-slate-800">{v}</dd></div>
        ))}
      </dl>
      {e.rangeOfMotion.length > 0 && <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Amplitude de movimento</p><Table head={['Articulação', 'Movimento', 'Lado', 'Graus']} rows={e.rangeOfMotion.map((r) => [r.joint, r.movement, side(r.side), r.degrees != null ? `${r.degrees}°` : null])} /></div>}
      {e.strength.length > 0 && <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Força muscular</p><Table head={['Músculo', 'Lado', 'Grau']} rows={e.strength.map((r) => [r.muscle, side(r.side), `${r.grade}/5`])} /></div>}
      {e.tests.length > 0 && <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Testes</p><Table head={['Teste', 'Resultado', 'Observação']} rows={e.tests.map((r) => [r.name, r.result, r.notes])} /></div>}
      {e.scales.length > 0 && <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Escalas</p><Table head={['Escala', 'Pontuação', 'Interpretação']} rows={e.scales.map((r) => [r.name, r.score, r.interpretation])} /></div>}
      {e.conclusion && <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-900"><span className="font-semibold">Conclusão: </span>{e.conclusion}</div>}
    </div>
  );
}

export default function EvaluationsTab({ patient }: { patient: PatientDetail }) {
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['evaluations', patient.id], queryFn: () => api<Evaluation[]>(`/patients/${patient.id}/evaluations`) });
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Evaluation | 'new' | null>(null);
  if (q.isLoading) return <Card><LoadingState rows={2} /></Card>;
  if (q.isError) return <Card><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></Card>;
  const list = q.data ?? [];
  const firstOpen = open ?? list[0]?.id ?? null;
  const pains = [...list].reverse().filter((e) => e.painScale != null);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Avaliações"
          description={pains.length >= 2 ? `Dor: ${pains.map((e) => e.painScale).join(' → ')} (da primeira à mais recente)` : 'Avaliação inicial e reavaliações'}
          actions={can('clinical.write') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{list.length ? 'Nova reavaliação' : 'Avaliação inicial'}</Button>}
        />
        {list.length === 0 && <EmptyState icon={<ClipboardCheck className="size-6" />} title="Nenhuma avaliação" description="Registre a avaliação inicial para guiar o plano de tratamento." />}
        <ul className="divide-y divide-slate-100">
          {list.map((e) => {
            const expanded = firstOpen === e.id;
            return (
              <li key={e.id}>
                <button onClick={() => setOpen(expanded ? '' : e.id)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50/60">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">{EVAL_TYPES[e.type]} <PainBadge value={e.painScale} /></p>
                    <p className="text-xs text-slate-500">{formatDateTime(e.performedAt)} · {e.professional.name}</p>
                  </div>
                  {(e.professional.id === me?.user.id || can('clinical.delete')) && can('clinical.write') && (
                    <span role="button" tabIndex={0} onClick={(ev) => { ev.stopPropagation(); setEditing(e); }} className="rounded-lg px-2 py-1 text-sm text-brand-700 hover:bg-brand-50">Editar</span>
                  )}
                  <ChevronDown className={clsx('size-4 text-slate-400 transition-transform', expanded && 'rotate-180')} />
                </button>
                {expanded && <EvaluationDetail e={e} />}
              </li>
            );
          })}
        </ul>
      </Card>
      {list.length > 0 && <p className="text-xs text-slate-400"><Badge>Registro clínico</Badge> Toda consulta e alteração fica registrada na auditoria.</p>}
      {editing && <EvaluationModal patientId={patient.id} initial={editing === 'new' ? undefined : editing} defaultType={list.length ? 'FOLLOW_UP' : 'INITIAL'} onClose={() => setEditing(null)} />}
    </div>
  );
}
