import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowRight, Bell, CalendarCheck2, CheckCircle2, Circle, ClipboardList, Info, MessageCircle, Package, TrendingUp, UserCheck, Wallet,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Badge, Card, CardHeader, ErrorState, LoadingState, PageHeader, Tabs } from '@/components/ui';
import { ColumnChart } from '@/components/charts';
import { GoalsPanel, StatTile } from '@/pages/finance/FinancePage';
import { TodayAppointments } from '@/pages/clinical/TodayAppointments';

interface RangeStats {
  appointments: number; scheduled: number; confirmed: number; done: number; cancelled: number; noShows: number; rescheduled: number;
  patients: number; sessions: number; occupancyRate: number; bookedSlots: number; freeSlots: number;
}
interface Dashboard {
  scope: 'mine' | 'clinic';
  canSeeMoney: boolean;
  today: RangeStats & { date: string };
  week: RangeStats & { from: string; newPatients: number; recurringPatients: number };
  month: RangeStats & { from: string; to: string; newPatients: number; activePatients: number; inactivePatients: number; returnRate: number | null };
  finance: null | {
    today: { expectedCents: number; receivedCents: number };
    week: { expectedCents: number; receivedCents: number };
    month: { billedCents: number; receivedCents: number; expectedCents: number; averageTicketCents: number; overdueCents: number };
    projection: { monthCents: number; next3Cents: number; next6Cents: number };
  };
  pending: { key: string; label: string; link: string; severity: 'info' | 'warning' | 'critical'; amountCents?: number }[];
  noReturn: { id: string; name: string; lastSessionAt: string }[];
  packagesEnding: { id: string; name: string; remaining: number; patient: { id: string; name: string } }[];
  counts: { pending: number; messages: number; alerts: number; tasks: number };
  trend: { weekStart: string; sessions: number; lost: number }[];
}
interface Goals { items: { metric: string; target: number | null; realized: number; percent: number | null; projectedPercent: number | null }[] }

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm text-slate-600">{label}{hint && <span className="ml-1 text-xs text-slate-400">{hint}</span>}</dt>
      <dd className="text-sm font-semibold text-slate-900 tabular">{value}</dd>
    </div>
  );
}

function PeriodPanel({ d }: { d: Dashboard }) {
  const [p, setP] = useState<'today' | 'week' | 'month'>('today');
  const r = d[p];
  const f = d.finance;
  return (
    <Card>
      <CardHeader title="Indicadores" description={d.scope === 'mine' ? 'Da sua agenda' : 'De toda a clínica'} />
      <div className="px-5 pt-1"><Tabs value={p} onChange={setP} tabs={[{ value: 'today', label: 'Hoje' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mês' }]} /></div>
      <dl className="grid gap-x-8 px-5 py-3 sm:grid-cols-2">
        <div className="divide-y divide-slate-100">
          <Row label="Consultas" value={r.appointments} />
          <Row label="Confirmadas" value={r.confirmed} />
          <Row label="Aguardando confirmação" value={r.scheduled} />
          <Row label="Realizadas" value={r.done} />
          <Row label="Sessões registradas" value={r.sessions} />
          <Row label="Pacientes atendidos" value={r.patients} />
        </div>
        <div className="divide-y divide-slate-100">
          <Row label="Cancelamentos" value={r.cancelled} />
          <Row label="Faltas" value={r.noShows} />
          <Row label="Remarcações" value={r.rescheduled} />
          <Row label="Taxa de ocupação" value={pct(r.occupancyRate)} />
          <Row label="Horários livres" value={r.freeSlots} hint="aprox." />
          {p === 'week' && <Row label="Novos · recorrentes" value={`${d.week.newPatients} · ${d.week.recurringPatients}`} />}
          {p === 'month' && <Row label="Novos pacientes" value={d.month.newPatients} />}
          {p === 'today' && f && <Row label="Previsto hoje" value={formatMoney(f.today.expectedCents)} />}
        </div>
      </dl>
      {f && p !== 'today' && (
        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 px-5 py-3 text-sm">
          <div><p className="text-slate-500">Recebido</p><p className="font-semibold text-slate-900 tabular">{formatMoney(f[p].receivedCents)}</p></div>
          <div><p className="text-slate-500">Previsto a receber</p><p className="font-semibold text-slate-900 tabular">{formatMoney(f[p].expectedCents)}</p></div>
        </div>
      )}
    </Card>
  );
}

const SEVERITY = {
  critical: { icon: AlertTriangle, cls: 'text-red-600' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600' },
  info: { icon: Info, cls: 'text-slate-400' },
} as const;

function PendingCard({ d }: { d: Dashboard }) {
  return (
    <Card>
      <CardHeader title="Pendências" description={d.pending.length ? `${d.pending.length} ponto(s) de atenção` : 'Tudo em dia'} />
      {d.pending.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-slate-600"><CheckCircle2 className="size-5 text-emerald-600" /> Nenhuma pendência agora.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {d.pending.map((p) => {
            const S = SEVERITY[p.severity];
            return (
              <li key={p.key}>
                <Link to={p.link} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <S.icon className={clsx('size-4 shrink-0', S.cls)} aria-label={p.severity === 'critical' ? 'Crítico' : p.severity === 'warning' ? 'Atenção' : 'Informativo'} />
                  <span className="flex-1 text-sm text-slate-800">{p.label}</span>
                  {p.amountCents != null && <span className="text-sm font-medium text-red-700 tabular">{formatMoney(p.amountCents)}</span>}
                  <ArrowRight className="size-3.5 text-slate-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(d.noReturn.length > 0 || d.packagesEnding.length > 0) && (
        <div className="grid gap-4 border-t border-slate-100 px-5 py-4 sm:grid-cols-2">
          {d.noReturn.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sem retorno</p>
              <ul className="space-y-1.5">
                {d.noReturn.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 text-sm">
                    <Link to={`/pacientes/${p.id}`} className="truncate text-slate-800 hover:text-brand-700 hover:underline">{p.name}</Link>
                    <span className="shrink-0 text-xs text-slate-500">última {formatDate(p.lastSessionAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.packagesEnding.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pacotes acabando</p>
              <ul className="space-y-1.5">
                {d.packagesEnding.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 text-sm">
                    <Link to={`/pacientes/${p.patient.id}`} className="truncate text-slate-800 hover:text-brand-700 hover:underline">{p.patient.name}</Link>
                    <span className="shrink-0 text-xs text-slate-500">{p.remaining <= 0 ? 'esgotado' : `resta${p.remaining > 1 ? 'm' : ''} ${p.remaining}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function FirstSteps() {
  const { me, can } = useAuth();
  if (!me) return null;
  const steps = [
    { done: me.organization.onboardingCompleted, label: 'Configuração inicial da clínica', to: '/primeiro-acesso' },
    ...(can('users.manage') ? [{ done: false, label: 'Cadastrar a equipe (fisioterapeutas e recepção)', to: '/configuracoes/usuarios' }] : []),
    { done: false, label: 'Cadastrar os primeiros pacientes', to: '/pacientes' },
    { done: false, label: 'Montar a agenda da semana', to: '/agenda' },
    ...(can('settings.manage') ? [{ done: false, label: 'Criar modelos de pacote', to: '/configuracoes/pacotes' }] : []),
  ];
  return (
    <Card>
      <CardHeader title="Primeiros passos" description="Some assim que o primeiro paciente for cadastrado." />
      <ul className="divide-y divide-slate-100">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 px-5 py-3">
            {s.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : <Circle className="size-5 shrink-0 text-slate-300" />}
            <span className={clsx('flex-1 text-sm', s.done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800')}>{s.label}</span>
            {!s.done && <Link to={s.to} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Abrir <ArrowRight className="size-3.5" /></Link>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HomePage() {
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard'), refetchInterval: 120_000 });
  const goals = useQuery({ queryKey: ['finance', 'goals', 'current'], queryFn: () => api<Goals>('/finance/goals'), enabled: !!q.data?.canSeeMoney });
  if (!me) return null;
  const firstName = me.user.name.split(' ')[0];
  const d = q.data;
  const revenueGoal = goals.data?.items.find((g) => g.metric === 'REVENUE');

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`Como está sua clínica hoje? · ${me.organization.clinicName}`}
        actions={d?.scope === 'mine' ? <Badge tone="brand">Sua agenda</Badge> : undefined}
      />
      {q.isLoading && <LoadingState rows={6} />}
      {q.isError && <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />}
      {d && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {d.finance ? (
              <StatTile label="Faturamento do mês" icon={<Wallet className="size-4 text-slate-400" />} value={formatMoney(d.finance.month.billedCents)} hint={`${formatMoney(d.finance.month.receivedCents)} recebido`} />
            ) : (
              <StatTile label="Sessões no mês" icon={<ClipboardList className="size-4 text-slate-400" />} value={d.month.sessions} hint={`${d.week.sessions} nesta semana`} />
            )}
            <StatTile label="Consultas hoje" icon={<CalendarCheck2 className="size-4 text-slate-400" />} value={d.today.appointments} hint={`${d.today.confirmed} confirmada(s) · ocupação ${pct(d.today.occupancyRate)}`} />
            <StatTile label="Pacientes ativos" icon={<UserCheck className="size-4 text-slate-400" />} value={d.month.activePatients} hint={`${d.month.newPatients} novo(s) no mês · retorno ${pct(d.month.returnRate)}`} />
            {d.finance ? (
              <StatTile
                label="Meta do mês"
                icon={<TrendingUp className="size-4 text-slate-400" />}
                value={revenueGoal?.target != null ? pct(revenueGoal.percent) : '—'}
                hint={revenueGoal?.target != null ? `Projeção ${formatMoney(d.finance.projection.monthCents)} · ${pct(revenueGoal.projectedPercent)} da meta` : `Projeção ${formatMoney(d.finance.projection.monthCents)} · sem meta definida`}
              />
            ) : (
              <StatTile label="Ocupação da semana" icon={<TrendingUp className="size-4 text-slate-400" />} value={pct(d.week.occupancyRate)} hint={`${d.week.freeSlots} horário(s) livre(s)`} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Pendências', n: d.counts.pending, icon: AlertTriangle, to: '#pendencias', show: true },
              { label: 'Mensagens em aberto', n: d.counts.messages, icon: MessageCircle, to: '/comunicacao', show: can('messages.read') },
              { label: 'Alertas não lidos', n: d.counts.alerts, icon: Bell, to: '/notificacoes', show: true },
              { label: 'Tarefas', n: d.counts.tasks, icon: ClipboardList, to: '/tarefas', show: can('tasks.manage') },
            ].filter((x) => x.show).map((x) => (
              <a key={x.label} href={x.to} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand-300">
                <x.icon className="size-4 text-slate-400" />
                <span className="flex-1 text-sm text-slate-600">{x.label}</span>
                <span className={clsx('text-lg font-semibold tabular', x.n ? 'text-slate-900' : 'text-slate-400')}>{x.n}</span>
              </a>
            ))}
          </div>

          {d.scope === 'clinic' && d.month.activePatients === 0 && d.month.sessions === 0 && d.today.appointments === 0 && <FirstSteps />}

          <div className="grid gap-6 lg:grid-cols-2">
            <TodayAppointments />
            <div id="pendencias"><PendingCard d={d} /></div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <PeriodPanel d={d} />
            <Card>
              <CardHeader title="Sessões por semana" description="Sessões registradas nas últimas 8 semanas" />
              <div className="p-5">
                <ColumnChart
                  ariaLabel="Sessões registradas por semana"
                  data={d.trend.map((t) => ({ ...t, label: t.weekStart.slice(8, 10) + '/' + t.weekStart.slice(5, 7) }))}
                  xKey="label"
                  series={[{ key: 'sessions', name: 'Sessões' }]}
                  format={(v) => v.toLocaleString('pt-BR')}
                  height={220}
                  integer
                />
              </div>
            </Card>
          </div>

          {d.finance && (
            <div className="grid gap-6 lg:grid-cols-2">
              <GoalsPanel compactView />
              <Card>
                <CardHeader title="Projeção de receita" description="Recebido + previsto (agendamentos, pacotes e cobranças em aberto)" actions={<Link to="/financeiro" className="text-sm font-medium text-brand-700 hover:underline">Financeiro</Link>} />
                <dl className="divide-y divide-slate-100 px-5 py-2">
                  <Row label="Fechamento previsto do mês" value={formatMoney(d.finance.projection.monthCents)} />
                  <Row label="Próximos 3 meses" value={formatMoney(d.finance.projection.next3Cents)} />
                  <Row label="Próximos 6 meses" value={formatMoney(d.finance.projection.next6Cents)} />
                  <Row label="Ticket médio no mês" value={formatMoney(d.finance.month.averageTicketCents)} />
                  <Row label="Em atraso" value={<span className={d.finance.month.overdueCents ? 'text-red-700' : undefined}>{formatMoney(d.finance.month.overdueCents)}</span>} />
                </dl>
                {d.packagesEnding.length > 0 && (
                  <p className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
                    <Package className="size-4 text-amber-600" /> {d.packagesEnding.length} pacote(s) perto do fim — oportunidade de renovação.
                  </p>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
