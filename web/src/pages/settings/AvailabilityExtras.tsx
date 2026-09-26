import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarOff, Download, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { addDaysKey, dayKey, fromLocal, toMinutes } from '@/lib/agenda';
import type { DayHours } from '@/lib/types';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, LoadingState, Modal, Select } from '@/components/ui';
import { HoursEditor, hoursErrors, PRESET_HOURS } from '@/components/editors';
import { useProfessionals } from '@/components/crm-forms';

const KINDS: Record<string, string> = {
  DAY_OFF: 'Folga', VACATION: 'Férias', BLOCK: 'Bloqueio', BREAK: 'Intervalo', SPECIAL_HOURS: 'Horário especial (substitui o dia)', EXTRA_HOURS: 'Atendimento extraordinário (horas extras)',
};

interface Exception { id: string; kind: string; startsAt: string; endsAt: string; reason: string | null; professionalId: string | null; professionalName: string | null }
interface Holiday { id: string; date: string; name: string; isRecurring: boolean }

function ExceptionModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { can, me } = useAuth();
  const pros = useProfessionals();
  const [kind, setKind] = useState('DAY_OFF');
  const [professionalId, setProfessionalId] = useState(can('schedule.availability') ? '' : me?.user.id ?? '');
  const [startDate, setStartDate] = useState(dayKey(new Date()));
  const [endDate, setEndDate] = useState(dayKey(new Date()));
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('12:00');
  const [endTime, setEndTime] = useState('13:00');
  const [reason, setReason] = useState('');
  useEffect(() => { if (kind === 'SPECIAL_HOURS' || kind === 'EXTRA_HOURS' || kind === 'BREAK') setAllDay(false); if (kind === 'VACATION' || kind === 'DAY_OFF') setAllDay(true); }, [kind]);
  const startsAt = fromLocal(startDate, allDay ? 0 : toMinutes(startTime));
  const endsAt = allDay ? fromLocal(addDaysKey(endDate, 1), 0) : fromLocal(allDay ? endDate : startDate, toMinutes(endTime));
  const invalid = endsAt <= startsAt;
  const save = useMutation({
    mutationFn: () => api('/schedule/exceptions', { method: 'POST', body: { kind, professionalId: professionalId || undefined, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exceptions'] }); qc.invalidateQueries({ queryKey: ['agenda'] }); toast.success('Exceção cadastrada'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="Folga, férias ou horário especial" footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" className="sm:col-span-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        <Field label="Profissional" className="sm:col-span-2">
          <Select value={professionalId} disabled={!can('schedule.availability')} onChange={(e) => setProfessionalId(e.target.value)}>
            <option value="">Toda a clínica</option>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2"><Checkbox checked={allDay} onChange={setAllDay} label="Dia inteiro" /></div>
        {allDay ? (
          <>
            <Field label="De"><Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} /></Field>
            <Field label="Até" error={invalid ? 'Depois do início' : undefined}><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </>
        ) : (
          <>
            <Field label="Data" className="sm:col-span-2"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="Das"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
            <Field label="Às" error={invalid ? 'Depois do início' : undefined}><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
          </>
        )}
        <Field label="Motivo" className="sm:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: congresso, recesso, plantão de sábado" /></Field>
      </div>
    </Modal>
  );
}

export function AvailabilityExtras() {
  const qc = useQueryClient();
  const { can, me } = useAuth();
  const pros = useProfessionals();
  const from = fromLocal(dayKey(new Date()), 0).toISOString();
  const to = fromLocal(addDaysKey(dayKey(new Date()), 365), 0).toISOString();
  const exceptions = useQuery({ queryKey: ['exceptions'], queryFn: () => api<Exception[]>(`/schedule/exceptions?from=${from}&to=${to}`) });
  const holidays = useQuery({ queryKey: ['holidays'], queryFn: () => api<Holiday[]>('/schedule/holidays') });
  const [adding, setAdding] = useState(false);
  const [hName, setHName] = useState('');
  const [hDate, setHDate] = useState('');
  const [hRec, setHRec] = useState(false);
  const year = new Date().getFullYear();
  const delEx = useMutation({ mutationFn: (id: string) => api(`/schedule/exceptions/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['exceptions'] }); qc.invalidateQueries({ queryKey: ['agenda'] }); toast.success('Removido'); }, onError: (e) => toast.error(e.message) });
  const addHol = useMutation({ mutationFn: () => api('/schedule/holidays', { method: 'POST', body: { date: hDate, name: hName, isRecurring: hRec } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); setHName(''); setHDate(''); toast.success('Feriado cadastrado'); }, onError: (e) => toast.error(e.message) });
  const national = useMutation({ mutationFn: (y: number) => api('/schedule/holidays/national', { method: 'POST', body: { year: y } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); toast.success('Feriados nacionais importados'); }, onError: (e) => toast.error(e.message) });
  const delHol = useMutation({ mutationFn: (id: string) => api(`/schedule/holidays/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }), onError: (e) => toast.error(e.message) });

  // Horário próprio por profissional
  const [proId, setProId] = useState('');
  useEffect(() => { if (!proId && pros.data?.length) setProId(can('schedule.availability') ? pros.data[0].id : me?.user.id ?? ''); }, [pros.data, proId, can, me]);
  const proHours = useQuery({ queryKey: ['pro-hours', proId], queryFn: () => api<{ usesUnitHours: boolean; days: DayHours[] }>(`/schedule/professionals/${proId}/hours`), enabled: !!proId });
  const [own, setOwn] = useState(false);
  const [days, setDays] = useState<DayHours[]>(PRESET_HOURS);
  useEffect(() => { if (proHours.data) { setOwn(!proHours.data.usesUnitHours); setDays(proHours.data.usesUnitHours ? PRESET_HOURS : proHours.data.days); } }, [proHours.data]);
  const saveHours = useMutation({
    mutationFn: () => api(`/schedule/professionals/${proId}/hours`, { method: 'PUT', body: { days: own ? days : [] } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pro-hours'] }); qc.invalidateQueries({ queryKey: ['agenda'] }); toast.success('Horário do profissional salvo'); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Folgas, férias e horários especiais" description="Próximos 12 meses" actions={can('schedule.write') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Adicionar</Button>} />
        {exceptions.isLoading && <LoadingState rows={2} />}
        {exceptions.data?.length === 0 && <EmptyState icon={<CalendarOff className="size-6" />} title="Nenhuma exceção cadastrada" />}
        <ul className="divide-y divide-slate-100">
          {exceptions.data?.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-5 py-3">
              <Badge tone={e.kind === 'EXTRA_HOURS' || e.kind === 'SPECIAL_HOURS' ? 'green' : 'amber'}>{KINDS[e.kind].split(' (')[0]}</Badge>
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-slate-800">{formatDateTime(e.startsAt)} → {formatDateTime(e.endsAt)}</p>
                <p className="text-xs text-slate-500">{e.professionalName ?? 'Toda a clínica'}{e.reason && ` · ${e.reason}`}</p>
              </div>
              <Button variant="ghost" size="sm" aria-label="Remover" onClick={() => delEx.mutate(e.id)}><Trash2 className="size-4 text-red-600" /></Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Feriados" description="Nos feriados a agenda fica fechada, exceto horários extras cadastrados."
          actions={can('schedule.availability') && <Button variant="outline" size="sm" icon={<Download className="size-4" />} loading={national.isPending} onClick={() => national.mutate(year)}>Importar nacionais de {year}</Button>} />
        {can('schedule.availability') && (
          <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[1fr_160px_auto_auto] sm:items-end">
            <Field label="Nome"><Input value={hName} onChange={(e) => setHName(e.target.value)} placeholder="Ex.: Aniversário da cidade" /></Field>
            <Field label="Data"><Input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} /></Field>
            <div className="pb-2"><Checkbox checked={hRec} onChange={setHRec} label="Todo ano" /></div>
            <Button disabled={hName.trim().length < 2 || !hDate} loading={addHol.isPending} onClick={() => addHol.mutate()}>Adicionar</Button>
          </div>
        )}
        {holidays.data?.length === 0 && <EmptyState title="Nenhum feriado cadastrado" description={`Use "Importar nacionais de ${year}" para começar.`} />}
        <ul className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
          {holidays.data?.filter((h) => h.isRecurring || h.date >= `${year}-01-01`).map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-5 py-2.5 sm:border-b sm:border-slate-100">
              <span className="w-24 text-sm font-medium text-slate-900 tabular">{h.isRecurring ? h.date.slice(5).split('-').reverse().join('/') : h.date.split('-').reverse().join('/')}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{h.name}{h.isRecurring && <span className="text-xs text-slate-400"> · anual</span>}</span>
              {can('schedule.availability') && <button onClick={() => delHol.mutate(h.id)} className="text-slate-400 hover:text-red-600" aria-label="Remover"><Trash2 className="size-4" /></button>}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Horário por profissional" description="Para quem atende em horários diferentes dos da clínica." />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <Select className="w-64" value={proId} disabled={!can('schedule.availability')} onChange={(e) => setProId(e.target.value)}>
              {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Checkbox checked={own} onChange={setOwn} label="Usar horário próprio" description={own ? undefined : 'Segue o horário de atendimento da clínica'} />
          </div>
          {own && <HoursEditor value={days} onChange={setDays} />}
          <Button disabled={own && Object.keys(hoursErrors(days)).length > 0} loading={saveHours.isPending} onClick={() => saveHours.mutate()}>Salvar horário do profissional</Button>
        </div>
      </Card>
      {adding && <ExceptionModal onClose={() => setAdding(false)} />}
    </div>
  );
}
