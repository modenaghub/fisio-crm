import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CalendarClock, Check, CheckCircle2, Clock, MessageCircle, Play, Repeat, Stethoscope, UserX, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatMoney, whatsappLink } from '@/lib/format';
import { addDaysKey, dayKey, fromLocal, hhmm, minutesOfDay, STATUS_STYLE, toMinutes, weekdayOf, type Appointment } from '@/lib/agenda';
import type { ServiceRow } from '@/lib/types';
import { Avatar, Badge, Button, Checkbox, ConfirmDialog, Field, Input, Modal, Select, Spinner, Textarea } from './ui';
import { MoneyInput } from './editors';
import { PatientPicker, type PickedPatient } from './PatientPicker';
import { useProfessionals } from './crm-forms';
import { SessionFormModal } from './clinical';

export function useServices() {
  return useQuery({ queryKey: ['services'], queryFn: () => api<ServiceRow[]>('/settings/services'), staleTime: 60_000 });
}

export const invalidateAgenda = (qc: ReturnType<typeof useQueryClient>) => {
  for (const k of ['agenda', 'patient', 'patients', 'dashboard', 'appointments-today', 'crm-board', 'patient-appointments']) qc.invalidateQueries({ queryKey: [k] });
};

/** Trata 409 da agenda: devolve a mensagem e se pode forçar. */
export function conflictInfo(e: unknown): { message: string; canForce: boolean } | null {
  if (e instanceof ApiError && e.status === 409) {
    const d = e.details as { code?: string; message?: string; canForce?: boolean };
    if (d?.code === 'CONFLICT' || d?.code === 'OUTSIDE_HOURS') return { message: d.message ?? e.message, canForce: !!d.canForce };
  }
  return null;
}

const WD_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface RecurrencePreview { total: number; ok: number; conflicts: { startsAt: string; problem: string }[]; dates: { startsAt: string; problem: string | null }[] }

// ───────────────────────── Novo agendamento (avulso ou recorrente) ─────────────────────────

export function NewAppointmentModal({
  onClose,
  defaults,
}: {
  onClose: () => void;
  defaults?: { date?: string; minutes?: number; professionalId?: string; patient?: PickedPatient | null };
}) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const pros = useProfessionals();
  const services = useServices();
  const [patient, setPatient] = useState<PickedPatient | null>(defaults?.patient ?? null);
  const [professionalId, setProfessionalId] = useState(defaults?.professionalId ?? '');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(defaults?.date ?? dayKey(new Date()));
  const [time, setTime] = useState(defaults?.minutes != null ? hhmm(defaults.minutes) : '');
  const [duration, setDuration] = useState(50);
  const [price, setPrice] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [endMode, setEndMode] = useState<'months' | 'count' | 'date' | 'package'>('months');
  const [months, setMonths] = useState(3);
  const [count, setCount] = useState(10);
  const [endDate, setEndDate] = useState('');
  const [packageId, setPackageId] = useState('');
  const [preview, setPreview] = useState<RecurrencePreview | null>(null);
  const [conflict, setConflict] = useState<{ message: string; canForce: boolean } | null>(null);

  useEffect(() => {
    if (!professionalId && pros.data?.length) setProfessionalId(pros.data.find((p) => p.id === me?.user.id)?.id ?? pros.data[0].id);
  }, [pros.data, professionalId, me]);
  useEffect(() => {
    if (!serviceId && services.data?.length) {
      const s = services.data.find((x) => x.kind === 'SESSION') ?? services.data[0];
      setServiceId(s.id);
      setDuration(s.durationMinutes);
      setPrice(s.priceCents);
    }
  }, [services.data, serviceId]);
  useEffect(() => { if (repeat && !weekdays.length) setWeekdays([weekdayOf(date)]); }, [repeat, date, weekdays.length]);
  useEffect(() => setPreview(null), [repeat, weekdays, endMode, months, count, endDate, packageId, time, date, professionalId]);

  const slots = useQuery({
    queryKey: ['slots', professionalId, date, duration],
    queryFn: () => api<string[]>(`/schedule/slots?professionalId=${professionalId}&date=${date}&durationMinutes=${duration}`),
    enabled: !!professionalId && !!date,
  });
  const packages = useQuery({
    queryKey: ['patient-packages', patient?.id],
    queryFn: () => api<{ id: string; name: string; remaining: number; status: string }[]>(`/patients/${patient!.id}/packages`).catch(() => []),
    enabled: !!patient,
  });
  const activePackages = (packages.data ?? []).filter((p) => p.status === 'ACTIVE' && p.remaining > 0);

  const recurrenceBody = () => {
    const body: Record<string, unknown> = { patientId: patient?.id, professionalId, serviceId: serviceId || undefined, weekdays, time, durationMinutes: duration, startDate: date, priceCents: price ?? undefined };
    if (endMode === 'months') {
      const d = new Date(`${date}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + months);
      body.endDate = addDaysKey(d.toISOString().slice(0, 10), -1);
    } else if (endMode === 'count') body.occurrences = count;
    else if (endMode === 'date') body.endDate = endDate;
    if (packageId) body.packageId = packageId;
    return body;
  };

  const create = useMutation({
    mutationFn: async (force: boolean) => {
      if (repeat) return api<{ created: number }>('/appointments/recurring', { method: 'POST', body: { ...recurrenceBody(), skipConflicts: true, force } });
      return api('/appointments', {
        method: 'POST',
        body: { patientId: patient?.id, professionalId, serviceId: serviceId || undefined, startsAt: fromLocal(date, toMinutes(time)).toISOString(), durationMinutes: duration, priceCents: price ?? undefined, notes, packageId: packageId || undefined, force },
      });
    },
    onSuccess: (r) => {
      invalidateAgenda(qc);
      toast.success(repeat ? `${(r as { created: number }).created} sessões agendadas` : 'Agendamento criado');
      onClose();
    },
    onError: (e) => {
      const c = conflictInfo(e);
      if (c) setConflict(c);
      else toast.error(e.message);
    },
  });
  const runPreview = useMutation({
    mutationFn: () => api<RecurrencePreview>('/appointments/recurring', { method: 'POST', body: { ...recurrenceBody(), dryRun: true } }),
    onSuccess: setPreview,
    onError: (e) => toast.error(e.message),
  });

  const invalid = !patient || !professionalId || !date || !/^\d{2}:\d{2}$/.test(time) || (repeat && (!weekdays.length || (endMode === 'date' && !endDate) || (endMode === 'package' && !packageId)));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Novo agendamento"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {repeat && !preview ? (
            <Button disabled={invalid} loading={runPreview.isPending} onClick={() => runPreview.mutate()}>Ver datas</Button>
          ) : (
            <Button disabled={invalid || (repeat && preview?.ok === 0)} loading={create.isPending} onClick={() => create.mutate(false)}>
              {repeat ? `Agendar ${preview?.ok ?? ''} sessões` : 'Agendar'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Paciente" required><PatientPicker value={patient} onChange={setPatient} autoFocus={!patient} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Profissional" required>
            <Select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Serviço">
            <Select value={serviceId} onChange={(e) => { const s = services.data?.find((x) => x.id === e.target.value); setServiceId(e.target.value); if (s) { setDuration(s.durationMinutes); setPrice(s.priceCents); } }}>
              {services.data?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min · {formatMoney(s.priceCents)}</option>)}
            </Select>
          </Field>
          <Field label={repeat ? 'A partir de' : 'Data'} required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Horário" required>
            <Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        {!repeat && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Horários livres em {date.split('-').reverse().join('/')}</p>
            {slots.isLoading ? <Spinner /> : slots.data?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {slots.data.slice(0, 24).map((s) => {
                  const t = hhmm(minutesOfDay(s));
                  return <button key={s} type="button" onClick={() => setTime(t)} className={clsx('rounded-md px-2.5 py-1 text-xs font-medium tabular ring-1 ring-inset', time === t ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200 hover:bg-brand-50')}>{t}</button>;
                })}
              </div>
            ) : <p className="text-xs text-slate-400">Nenhum horário livre neste dia.</p>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duração">
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[20, 30, 40, 45, 50, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} minutos</option>)}
            </Select>
          </Field>
          <Field label="Valor"><MoneyInput cents={price} onChange={setPrice} /></Field>
        </div>
        {activePackages.length > 0 && (
          <Field label="Pacote" hint="As sessões realizadas descontam deste pacote.">
            <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">— Automático (pacote ativo, se houver) —</option>
              {activePackages.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.remaining} restante(s)</option>)}
            </Select>
          </Field>
        )}
        {!repeat && <Field label="Observações"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}

        <div className="rounded-xl border border-slate-200 p-4">
          <Checkbox checked={repeat} onChange={setRepeat} label="Agendamento recorrente" description="Ex.: 2 vezes por semana durante 3 meses, terças e quintas." />
          {repeat && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Dias da semana</p>
                <div className="flex flex-wrap gap-1.5">
                  {WD_LABELS.map((l, i) => (
                    <button key={l} type="button" onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} className={clsx('h-9 w-12 rounded-lg text-sm font-medium ring-1 ring-inset', weekdays.includes(i) ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{l}</button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">{weekdays.length}× por semana às {time || '--:--'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <Select value={endMode} onChange={(e) => setEndMode(e.target.value as typeof endMode)} aria-label="Duração da recorrência">
                  <option value="months">Por meses</option>
                  <option value="count">Número de sessões</option>
                  <option value="date">Até uma data</option>
                  {activePackages.length > 0 && <option value="package">Saldo do pacote</option>}
                </Select>
                {endMode === 'months' && <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[1, 2, 3, 4, 6, 12].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'mês' : 'meses'}</option>)}</Select>}
                {endMode === 'count' && <Input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />}
                {endMode === 'date' && <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
                {endMode === 'package' && (
                  <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                    <option value="">Escolha o pacote</option>
                    {activePackages.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.remaining} sessões</option>)}
                  </Select>
                )}
              </div>
              {preview && (
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-800">{preview.ok} de {preview.total} datas disponíveis</p>
                  {preview.conflicts.length > 0 && <p className="text-xs text-amber-700">{preview.conflicts.length} data(s) com conflito serão ignoradas.</p>}
                  <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {preview.dates.map((d) => (
                      <span key={d.startsAt} title={d.problem ?? ''} className={clsx('rounded-md px-2 py-0.5 text-xs tabular ring-1 ring-inset', d.problem ? 'bg-red-50 text-red-700 line-through ring-red-200' : 'bg-white text-slate-700 ring-slate-200')}>
                        {formatDateTime(d.startsAt).slice(0, 5)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!conflict}
        onClose={() => setConflict(null)}
        onConfirm={() => { setConflict(null); create.mutate(true); }}
        tone="primary"
        title={conflict?.canForce ? 'Agendar mesmo assim?' : 'Não é possível agendar'}
        description={conflict?.message}
        confirmLabel={conflict?.canForce ? 'Agendar assim mesmo' : 'Entendi'}
      />
    </Modal>
  );
}

// ───────────────────────── Bloqueio de horário ─────────────────────────

export function BlockModal({ onClose, defaults }: { onClose: () => void; defaults?: { date?: string; minutes?: number; professionalId?: string } }) {
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const pros = useProfessionals();
  const [professionalId, setProfessionalId] = useState(defaults?.professionalId ?? me?.user.id ?? '');
  const [date, setDate] = useState(defaults?.date ?? dayKey(new Date()));
  const [start, setStart] = useState(defaults?.minutes != null ? hhmm(defaults.minutes) : '12:00');
  const [end, setEnd] = useState(defaults?.minutes != null ? hhmm(Math.min(24 * 60 - 5, defaults.minutes + 60)) : '13:00');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api('/appointments', { method: 'POST', body: { kind: 'BLOCK', professionalId, startsAt: fromLocal(date, toMinutes(start)).toISOString(), durationMinutes: toMinutes(end) - toMinutes(start), notes: reason } }),
    onSuccess: () => { invalidateAgenda(qc); toast.success('Horário bloqueado'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const invalid = !professionalId || toMinutes(end) <= toMinutes(start);
  return (
    <Modal open onClose={onClose} size="sm" title="Bloquear horário" description="O horário fica indisponível para agendamentos."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Bloquear</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Profissional" className="sm:col-span-2">
          <Select value={professionalId} disabled={!can('schedule.availability')} onChange={(e) => setProfessionalId(e.target.value)}>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Data" className="sm:col-span-2"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Início"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Fim" error={invalid && end ? 'Depois do início' : undefined}><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Motivo" className="sm:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: intervalo, reunião, curso" /></Field>
      </div>
    </Modal>
  );
}

// ───────────────────────── Detalhes e ações ─────────────────────────

interface Detail extends Appointment {
  history: { id: string; fromLabel: string | null; toLabel: string; by: string | null; channel: string | null; reason: string | null; createdAt: string }[];
}

export function AppointmentDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['agenda', 'appointment', id], queryFn: () => api<Detail>(`/appointments/${id}`) });
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel' | 'cancelSeries'>('view');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [reason, setReason] = useState('');
  const [registering, setRegistering] = useState(false);
  const [conflict, setConflict] = useState<{ message: string; canForce: boolean } | null>(null);

  const status = useMutation({
    mutationFn: (s: string) => api(`/appointments/${id}/status`, { method: 'POST', body: { status: s, reason: reason || undefined } }),
    onSuccess: (_, s) => { invalidateAgenda(qc); toast.success(`Status: ${STATUS_STYLE[s as Appointment['status']].label}`); if (s === 'CANCELLED') onClose(); setMode('view'); },
    onError: (e) => toast.error(e.message),
  });
  const resched = useMutation({
    mutationFn: (force: boolean) => api(`/appointments/${id}/reschedule`, { method: 'POST', body: { startsAt: fromLocal(newDate, toMinutes(newTime)).toISOString(), reason: reason || undefined, force } }),
    onSuccess: () => { invalidateAgenda(qc); toast.success('Reagendado'); onClose(); },
    onError: (e) => { const c = conflictInfo(e); if (c) setConflict(c); else toast.error(e.message); },
  });
  const cancelSeries = useMutation({
    mutationFn: () => api<{ cancelled: number }>(`/recurrence/${q.data!.seriesId}/cancel`, { method: 'POST', body: { fromDate: q.data!.startsAt, reason: reason || undefined } }),
    onSuccess: (r) => { invalidateAgenda(qc); toast.success(`${r.cancelled} sessão(ões) cancelada(s)`); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const a = q.data;
  const slots = useQuery({
    queryKey: ['slots', a?.professional.id, newDate, a?.durationMinutes],
    queryFn: () => api<string[]>(`/schedule/slots?professionalId=${a!.professional.id}&date=${newDate}&durationMinutes=${a!.durationMinutes}`),
    enabled: mode === 'reschedule' && !!a && !!newDate,
  });
  const open = a && ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status);
  const past = a && new Date(a.startsAt) <= new Date();
  const wa = whatsappLink(a?.patient?.whatsapp ?? a?.patient?.phone);
  const isEval = a?.service?.kind === 'EVALUATION';
  const title = useMemo(() => (a ? (a.kind === 'BLOCK' ? 'Horário bloqueado' : a.patient?.name ?? '') : ''), [a]);

  return (
    <Modal open onClose={onClose} size="lg" title={title || 'Agendamento'}>
      {!a ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            {a.patient && <Avatar name={a.patient.name} src={a.patient.photoUrl} />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                <CalendarClock className="size-4 text-slate-400" />
                {formatDateTime(a.startsAt)} – {hhmm(minutesOfDay(a.endsAt))} · {a.durationMinutes} min
              </p>
              <p className="text-slate-500">{a.professional.name}{a.service && ` · ${a.service.name}`}{a.kind !== 'BLOCK' && ` · ${formatMoney(a.priceCents)}`}</p>
            </div>
            <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', STATUS_STYLE[a.status].chip)}>{STATUS_STYLE[a.status].label}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {a.package && <Badge tone="violet">{a.package.name}</Badge>}
            {a.seriesId && <Badge tone="blue"><Repeat className="size-3" /> Recorrente</Badge>}
            {a.session && <Badge tone="green">Sessão {String(a.session.sessionNumber).padStart(2, '0')} registrada</Badge>}
            {a.rescheduledFromId && <Badge tone="amber">Reagendado</Badge>}
          </div>
          {a.notes && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{a.notes}</p>}
          {a.cancelReason && <p className="text-sm text-red-700">Motivo do cancelamento: {a.cancelReason}</p>}

          {mode === 'view' && open && can('schedule.write') && (
            <div className="flex flex-wrap gap-2">
              {a.status === 'SCHEDULED' && <Button variant="outline" icon={<Check className="size-4" />} loading={status.isPending && status.variables === 'CONFIRMED'} onClick={() => status.mutate('CONFIRMED')}>Confirmar presença</Button>}
              {a.status !== 'IN_PROGRESS' && <Button variant="outline" icon={<Play className="size-4" />} onClick={() => status.mutate('IN_PROGRESS')}>Iniciar atendimento</Button>}
              {can('clinical.write') && !isEval && <Button icon={<Stethoscope className="size-4" />} onClick={() => setRegistering(true)}>Registrar atendimento</Button>}
              {can('clinical.write') && isEval && a.patient && (
                <Link to={`/pacientes/${a.patient.id}?aba=avaliacao&agendamento=${a.id}`}><Button icon={<Stethoscope className="size-4" />}>Registrar avaliação</Button></Link>
              )}
              <Button variant="outline" icon={<Clock className="size-4" />} onClick={() => { setNewDate(dayKey(a.startsAt)); setNewTime(hhmm(minutesOfDay(a.startsAt))); setMode('reschedule'); }}>Reagendar</Button>
              {past && <Button variant="outline" icon={<UserX className="size-4" />} onClick={() => status.mutate('NO_SHOW')}>Faltou</Button>}
              <Button variant="ghost" className="text-red-600" icon={<X className="size-4" />} onClick={() => setMode('cancel')}>Cancelar</Button>
            </div>
          )}
          {mode === 'view' && a.status === 'BLOCKED' && can('schedule.write') && (
            <Button variant="outline" onClick={() => status.mutate('CANCELLED')} loading={status.isPending}>Remover bloqueio</Button>
          )}
          {mode === 'view' && ['NO_SHOW', 'CANCELLED'].includes(a.status) && a.patient && can('schedule.write') && (
            <Button icon={<Clock className="size-4" />} onClick={() => { setNewDate(dayKey(new Date())); setNewTime(''); setMode('reschedule'); }}>Remarcar</Button>
          )}

          {mode === 'reschedule' && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Novo horário</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              </div>
              {slots.data && (
                <div className="flex flex-wrap gap-1.5">
                  {slots.data.slice(0, 20).map((s) => { const t = hhmm(minutesOfDay(s)); return <button key={s} type="button" onClick={() => setNewTime(t)} className={clsx('rounded-md px-2 py-1 text-xs tabular ring-1 ring-inset', newTime === t ? 'bg-brand-700 text-white ring-brand-700' : 'ring-slate-200 hover:bg-brand-50')}>{t}</button>; })}
                  {slots.data.length === 0 && <p className="text-xs text-slate-400">Sem horários livres neste dia.</p>}
                </div>
              )}
              <Input placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <Button disabled={!newDate || !/^\d{2}:\d{2}$/.test(newTime)} loading={resched.isPending} onClick={() => resched.mutate(false)}>Reagendar</Button>
                <Button variant="outline" onClick={() => setMode('view')}>Voltar</Button>
              </div>
            </div>
          )}
          {mode === 'cancel' && (
            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-4">
              <Field label="Motivo do cancelamento"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" loading={status.isPending} onClick={() => status.mutate('CANCELLED')}>Cancelar este horário</Button>
                {a.seriesId && <Button variant="outline" className="text-red-700" loading={cancelSeries.isPending} onClick={() => cancelSeries.mutate()}>Cancelar este e os próximos da série</Button>}
                <Button variant="ghost" onClick={() => setMode('view')}>Voltar</Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-sm">
            {a.patient && <Link to={`/pacientes/${a.patient.id}`} className="font-medium text-brand-700 hover:underline">Abrir ficha do paciente</Link>}
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:underline"><MessageCircle className="size-4" /> WhatsApp</a>}
          </div>

          {a.history.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Histórico</p>
              <ol className="space-y-1.5 text-xs text-slate-600">
                {a.history.map((h) => (
                  <li key={h.id} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-slate-300" />
                    <span>{formatDateTime(h.createdAt)} — {h.fromLabel ? `${h.fromLabel} → ` : ''}{h.toLabel}{h.by && ` · ${h.by}`}{h.channel && h.channel !== 'sistema' && ` · via ${h.channel}`}{h.reason && ` · ${h.reason}`}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
      {registering && a?.patient && (
        <SessionFormModal patient={a.patient} appointment={{ id: a.id, startsAt: a.startsAt, service: a.service?.name }} onClose={() => setRegistering(false)} onSaved={() => { invalidateAgenda(qc); onClose(); }} />
      )}
      <ConfirmDialog open={!!conflict} onClose={() => setConflict(null)} onConfirm={() => { setConflict(null); if (conflict?.canForce) resched.mutate(true); }} tone="primary"
        title={conflict?.canForce ? 'Reagendar mesmo assim?' : 'Não é possível reagendar'} description={conflict?.message} confirmLabel={conflict?.canForce ? 'Reagendar assim mesmo' : 'Entendi'} />
    </Modal>
  );
}

