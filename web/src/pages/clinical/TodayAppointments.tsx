import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hhmm, minutesOfDay, STATUS_STYLE, type Appointment } from '@/lib/agenda';
import { Avatar, Button, Card, CardHeader, EmptyState, LoadingState } from '@/components/ui';
import { AppointmentDetailModal } from '@/components/agenda-forms';
import { SessionFormModal } from '@/components/clinical';

/** Agenda do dia com atalho para registrar o atendimento. */
export function TodayAppointments() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['appointments-today'], queryFn: () => api<Appointment[]>('/appointments/today'), enabled: can('schedule.read'), refetchInterval: 60_000 });
  const [registering, setRegistering] = useState<Appointment | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!can('schedule.read')) return null;
  const list = q.data ?? [];
  const pending = list.filter((a) => ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status));
  return (
    <Card>
      <CardHeader title="Hoje na agenda" description={q.data ? `${list.length} agendamento(s) · ${pending.length} a atender` : undefined} />
      {q.isLoading && <LoadingState rows={2} />}
      {q.data && list.length === 0 && <EmptyState icon={<CalendarDays className="size-6" />} title="Nenhum atendimento hoje" />}
      <ul className="divide-y divide-slate-100">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-5 py-3">
            <span className="w-12 text-sm font-semibold text-slate-900 tabular">{hhmm(minutesOfDay(a.startsAt))}</span>
            <Avatar name={a.patient?.name ?? '?'} src={a.patient?.photoUrl} size="sm" />
            <button onClick={() => setOpenId(a.id)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium text-slate-900">{a.patient?.name}</p>
              <p className="truncate text-xs text-slate-500">{a.service?.name ?? 'Atendimento'} · {a.professional.name}</p>
            </button>
            <span className={clsx('hidden rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset sm:inline', STATUS_STYLE[a.status].chip)}>{STATUS_STYLE[a.status].label}</span>
            {can('clinical.write') && ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status) && a.service?.kind !== 'EVALUATION' && (
              <Button size="sm" onClick={() => setRegistering(a)}>Registrar</Button>
            )}
          </li>
        ))}
      </ul>
      {registering?.patient && <SessionFormModal patient={registering.patient} appointment={{ id: registering.id, startsAt: registering.startsAt, service: registering.service?.name }} onClose={() => setRegistering(null)} onSaved={() => q.refetch()} />}
      {openId && <AppointmentDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
