import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarPlus, Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatMoney } from '@/lib/format';
import { STATUS_STYLE, type Appointment } from '@/lib/agenda';
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { AppointmentDetailModal, NewAppointmentModal } from '@/components/agenda-forms';
import type { PatientDetail } from '../PatientPage';

interface Data {
  summary: { done: number; future: number; cancelled: number; noShow: number; rescheduled: number; remaining: number | null; remainingSource: 'package' | 'plan' | null };
  series: { id: string; weekdays: number[]; startTime: string; startDate: string; endDate: string | null; occurrences: number | null }[];
  appointments: Appointment[];
}
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export default function ScheduleTab({ patient }: { patient: PatientDetail }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['patient-appointments', patient.id], queryFn: () => api<Data>(`/patients/${patient.id}/appointments`) });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  if (q.isLoading) return <Card><LoadingState rows={3} /></Card>;
  if (q.isError || !q.data) return <Card><ErrorState message={q.error?.message} onRetry={() => q.refetch()} /></Card>;
  const { summary, series, appointments } = q.data;
  const now = Date.now();
  const future = appointments.filter((a) => +new Date(a.startsAt) >= now && ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status)).reverse();
  const past = appointments.filter((a) => !future.includes(a) && a.status !== 'RESCHEDULED');
  const stats = [
    ['Realizadas', summary.done, 'text-emerald-700'],
    ['Futuras', summary.future, 'text-sky-700'],
    ['Canceladas', summary.cancelled, 'text-slate-700'],
    ['Faltas', summary.noShow, 'text-red-700'],
    ['Restantes', summary.remaining ?? '—', 'text-brand-800'],
  ] as const;
  const Row = ({ a }: { a: Appointment }) => (
    <li>
      <button onClick={() => setOpenId(a.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50/60">
        <span className={clsx('size-2 shrink-0 rounded-full', STATUS_STYLE[a.status].dot)} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 tabular">{formatDateTime(a.startsAt)}</p>
          <p className="truncate text-xs text-slate-500">{a.service?.name ?? 'Atendimento'} · {a.professional.name}{a.session && ` · Sessão ${String(a.session.sessionNumber).padStart(2, '0')}`}</p>
        </div>
        {a.seriesId && <Repeat className="size-3.5 text-slate-400" />}
        <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_STYLE[a.status].chip)}>{STATUS_STYLE[a.status].label}</span>
        <span className="hidden w-20 text-right text-xs text-slate-500 tabular sm:block">{formatMoney(a.priceCents)}</span>
      </button>
    </li>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([label, value, color]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={clsx('text-2xl font-semibold tabular', color)}>{value}</p>
          </Card>
        ))}
      </div>
      {summary.remainingSource && <p className="-mt-2 text-xs text-slate-500">Restantes calculadas pelo {summary.remainingSource === 'package' ? 'saldo do pacote ativo' : 'plano de tratamento'}.</p>}
      {series.length > 0 && (
        <Card className="px-5 py-3">
          {series.map((s) => (
            <p key={s.id} className="flex items-center gap-2 text-sm text-slate-700"><Repeat className="size-4 text-brand-700" /> {s.weekdays.map((w) => WD[w]).join(', ')} às {s.startTime} · {s.occurrences} sessões a partir de {s.startDate.split('-').reverse().join('/')}</p>
          ))}
        </Card>
      )}
      <Card>
        <CardHeader title="Próximas sessões" actions={can('schedule.write') && <Button size="sm" icon={<CalendarPlus className="size-4" />} onClick={() => setCreating(true)}>Agendar</Button>} />
        {future.length === 0 ? <EmptyState title="Nenhuma sessão futura" description="Agende uma sessão avulsa ou recorrente." /> : <ul className="divide-y divide-slate-100">{future.map((a) => <Row key={a.id} a={a} />)}</ul>}
      </Card>
      {past.length > 0 && (
        <Card>
          <CardHeader title="Histórico" />
          <ul className="divide-y divide-slate-100">{past.map((a) => <Row key={a.id} a={a} />)}</ul>
        </Card>
      )}
      {creating && <NewAppointmentModal defaults={{ patient: { id: patient.id, name: patient.name, code: patient.code, photoUrl: patient.photoUrl }, professionalId: patient.responsible?.id }} onClose={() => setCreating(false)} />}
      {openId && <AppointmentDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
