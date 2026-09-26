import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Ban, Check, Package, Plus, Search, Target } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatMoney, localDateKey, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs } from '@/components/ui';
import { ColumnChart, HBarList, Meter } from '@/components/charts';
import { MoneyInput } from '@/components/editors';
import {
  ExpenseModal,
  invalidateFinance,
  KIND_LABELS,
  PayModal,
  PayStatusBadge,
  ReceivableModal,
  SellPackageModal,
  type PackageRow,
  type Receivable,
} from '@/components/finance-forms';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
// Valores em centavos: R$ 1 milhão = 100.000.000 centavos.
const compact = (c: number) => (Math.abs(c) >= 100_000_000 ? `R$ ${(c / 100_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : formatMoney(c));

export function StatTile({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' | 'warn'; icon?: ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <p className="flex items-center gap-1.5 text-sm text-slate-500">{icon}{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tracking-tight', tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

// ───────────────────────── período ─────────────────────────

function usePeriod() {
  const today = localDateKey(new Date());
  const presets = useMemo(() => {
    const monthStart = `${today.slice(0, 7)}-01`;
    const prev = new Date(`${monthStart}T12:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1);
    const prevStart = prev.toISOString().slice(0, 10);
    const prevEnd = new Date(new Date(`${monthStart}T12:00:00Z`).getTime() - 86400e3).toISOString().slice(0, 10);
    const back = (n: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() - n * 86400e3).toISOString().slice(0, 10);
    const next = new Date(`${monthStart}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    const monthEnd = new Date(next.getTime() - 86400e3).toISOString().slice(0, 10);
    return { month: [monthStart, monthEnd], prev: [prevStart, prevEnd], d30: [back(29), today], d90: [back(89), today], year: [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`] } as Record<string, [string, string]>;
  }, [today]);
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState<[string, string]>(presets.month);
  const [from, to] = preset === 'custom' ? custom : presets[preset];
  return { from, to, preset, setPreset, custom, setCustom };
}

function PeriodBar({ p }: { p: ReturnType<typeof usePeriod> }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <Field label="Período" className="w-52">
        <Select value={p.preset} onChange={(e) => p.setPreset(e.target.value)}>
          <option value="month">Este mês</option>
          <option value="prev">Mês passado</option>
          <option value="d30">Últimos 30 dias</option>
          <option value="d90">Últimos 90 dias</option>
          <option value="year">Este ano</option>
          <option value="custom">Personalizado</option>
        </Select>
      </Field>
      {p.preset === 'custom' && (
        <>
          <Field label="De"><Input type="date" value={p.custom[0]} onChange={(e) => p.setCustom([e.target.value, p.custom[1]])} /></Field>
          <Field label="Até"><Input type="date" value={p.custom[1]} onChange={(e) => p.setCustom([p.custom[0], e.target.value])} /></Field>
        </>
      )}
      <p className="pb-2.5 text-sm text-slate-500">{formatDate(p.from)} a {formatDate(p.to)}</p>
    </div>
  );
}

// ───────────────────────── visão geral ─────────────────────────

interface Summary {
  receivedCents: number; expensesPaidCents: number; balanceCents: number; billedCents: number; openInPeriodCents: number; overdueCents: number; overdueCount: number;
  delinquencyRate: number; sessions: number; averageTicketCents: number; revenuePerSessionCents: number; revenuePerPatientCents: number;
  byMethod: Record<string, number>; byKind: Record<string, number>; expensesByCategory: { category: string; amountCents: number }[];
}

function Overview() {
  const p = usePeriod();
  const q = useQuery({ queryKey: ['finance', 'summary', p.from, p.to], queryFn: () => api<Summary>(`/finance/summary?from=${p.from}&to=${p.to}`), placeholderData: keepPreviousData });
  const monthly = useQuery({ queryKey: ['finance', 'monthly'], queryFn: () => api<{ month: string; receivedCents: number; expensesCents: number; billedCents: number }[]>('/finance/monthly') });
  const s = q.data;
  return (
    <>
      <PeriodBar p={p} />
      {q.isError && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
      {!s ? <LoadingState /> : (
        <div className={clsx('space-y-6', q.isFetching && 'opacity-70')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Faturamento" value={formatMoney(s.billedCents)} hint={`${formatMoney(s.openInPeriodCents)} ainda em aberto`} />
            <StatTile label="Recebido" icon={<ArrowDownRight className="size-4 text-emerald-600" />} value={formatMoney(s.receivedCents)} hint="Entradas no caixa" />
            <StatTile label="Despesas pagas" icon={<ArrowUpRight className="size-4 text-red-500" />} value={formatMoney(s.expensesPaidCents)} />
            <StatTile label="Saldo do período" value={formatMoney(s.balanceCents)} tone={s.balanceCents < 0 ? 'bad' : undefined} hint="Recebido − despesas pagas" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Em atraso" icon={<AlertTriangle className="size-4 text-red-600" />} value={formatMoney(s.overdueCents)} tone={s.overdueCents > 0 ? 'bad' : undefined} hint={`${s.overdueCount} cobrança(s) · inadimplência ${pct(s.delinquencyRate)}`} />
            <StatTile label="Ticket médio" value={formatMoney(s.averageTicketCents)} hint="Por cobrança no período" />
            <StatTile label="Receita por sessão" value={formatMoney(s.revenuePerSessionCents)} hint={`${s.sessions} sessões realizadas`} />
            <StatTile label="Receita por paciente" value={formatMoney(s.revenuePerPatientCents)} />
          </div>
          <Card>
            <CardHeader title="Recebido e despesas por mês" description="Últimos 6 meses, pelo caixa" />
            <div className="p-5">
              {monthly.data ? (
                <ColumnChart
                  ariaLabel="Recebido e despesas por mês"
                  data={monthly.data.map((m) => ({ ...m, label: `${MONTHS[Number(m.month.slice(5)) - 1]}/${m.month.slice(2, 4)}` }))}
                  xKey="label"
                  series={[{ key: 'receivedCents', name: 'Recebido' }, { key: 'expensesCents', name: 'Despesas' }]}
                  format={formatMoney}
                />
              ) : <LoadingState rows={2} />}
            </div>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Recebimentos por forma de pagamento" />
              <div className="p-5">
                {Object.keys(s.byMethod).length ? <HBarList format={formatMoney} items={Object.entries(s.byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: PAYMENT_METHOD_LABELS[k] ?? k, value: v }))} /> : <p className="text-sm text-slate-400">Nenhum recebimento no período.</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Despesas por categoria" description="Lançadas no período (pagas ou a pagar)" />
              <div className="p-5">
                {s.expensesByCategory.length ? <HBarList format={formatMoney} items={s.expensesByCategory.map((e) => ({ label: e.category, value: e.amountCents }))} /> : <p className="text-sm text-slate-400">Nenhuma despesa no período.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

// ───────────────────────── projeção ─────────────────────────

interface Window {
  key: string; label: string; from: string; to: string; realizedCents: number; expectedCents: number; potentialCents: number; lostCents: number;
  breakdown: { agendaSessions: number; agendaCents: number; averageSessionCents: number; recurringCents: number; packagesCents: number; otherReceivablesCents: number; packageCoveredSessions: number; freeSessions: number; cancellations: number; noShows: number };
}

function Projection() {
  const q = useQuery({ queryKey: ['finance', 'projection'], queryFn: () => api<{ windows: Window[]; overdueCents: number }>('/finance/projection') });
  const [key, setKey] = useState('month');
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState message={q.error?.message} onRetry={() => q.refetch()} />;
  const w = q.data.windows.find((x) => x.key === key) ?? q.data.windows[0];
  const b = w.breakdown;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1.5">
        {q.data.windows.map((x) => (
          <button key={x.key} onClick={() => setKey(x.key)} className={clsx('rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset', key === x.key ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{x.label}</button>
        ))}
      </div>
      <Card className="p-6">
        <p className="text-sm font-medium text-slate-500">Quanto vou faturar? · {w.label.toLowerCase()} ({formatDate(w.from)} a {formatDate(w.to)})</p>
        <p className="mt-2 text-5xl font-semibold tracking-tight text-slate-900">{formatMoney(w.expectedCents)}</p>
        <p className="mt-1 text-sm text-slate-500">receita prevista a entrar{w.realizedCents > 0 && <> · <strong className="font-medium text-slate-700">{formatMoney(w.realizedCents)}</strong> já recebidos no período</>}</p>
        <dl className="mt-6 max-w-xl divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-600">Agenda futura: {b.agendaSessions} sessões × {formatMoney(b.averageSessionCents)}</dt><dd className="font-medium tabular">{formatMoney(b.agendaCents)}</dd></div>
          {b.recurringCents > 0 && <div className="flex justify-between gap-4 px-4 py-2 pl-8 text-xs"><dt className="text-slate-500">das quais em agendamentos recorrentes</dt><dd className="tabular text-slate-500">{formatMoney(b.recurringCents)}</dd></div>}
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-600">Pacotes (parcelas a receber)</dt><dd className="font-medium tabular">{formatMoney(b.packagesCents)}</dd></div>
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-600">Outras cobranças a vencer</dt><dd className="font-medium tabular">{formatMoney(b.otherReceivablesCents)}</dd></div>
          <div className="flex justify-between gap-4 bg-slate-50 px-4 py-2.5"><dt className="font-semibold text-slate-900">Receita prevista</dt><dd className="font-semibold tabular">{formatMoney(w.expectedCents)}</dd></div>
        </dl>
        {b.packageCoveredSessions > 0 && <p className="mt-2 text-xs text-slate-500">{b.packageCoveredSessions} sessão(ões) agendada(s) já cobertas por pacote não entram de novo na conta.</p>}
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Receita realizada" value={formatMoney(w.realizedCents)} hint="Recebido no período até hoje" />
        <StatTile label="Receita potencial" value={formatMoney(w.potentialCents)} hint={`Se os ${b.freeSessions} horários livres fossem ocupados`} />
        <StatTile label="Receita perdida" value={formatMoney(w.lostCents)} tone={w.lostCents > 0 ? 'warn' : undefined} hint={`${b.cancellations} cancelamento(s) · ${b.noShows} falta(s)`} />
        <StatTile label="Receita em atraso" value={formatMoney(q.data.overdueCents)} tone={q.data.overdueCents > 0 ? 'bad' : undefined} hint="Vencida e não paga (todas as datas)" />
      </div>
      <Card>
        <CardHeader title="Todas as janelas" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500"><th className="px-5 py-2.5">Período</th><th className="px-3 py-2.5 text-right">Realizada</th><th className="px-3 py-2.5 text-right">Prevista</th><th className="px-3 py-2.5 text-right">Potencial</th><th className="px-5 py-2.5 text-right">Perdida</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.windows.map((x) => (
                <tr key={x.key} className={clsx(x.key === key && 'bg-brand-50/50')}>
                  <td className="px-5 py-2.5 font-medium text-slate-800">{x.label}</td>
                  <td className="px-3 py-2.5 text-right tabular">{compact(x.realizedCents)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular">{compact(x.expectedCents)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-slate-600">{compact(x.potentialCents)}</td>
                  <td className="px-5 py-2.5 text-right tabular text-slate-600">{compact(x.lostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ───────────────────────── contas a receber ─────────────────────────

function Receivables() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState('OPEN');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [paying, setPaying] = useState<Receivable | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Receivable | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const qs = new URLSearchParams({ pageSize: '200' });
  if (status !== 'ALL') qs.set('status', status);
  if (debounced) qs.set('search', debounced);
  const q = useQuery({ queryKey: ['finance', 'receivables', qs.toString()], queryFn: () => api<{ total: number; totals: { amountCents: number; paidCents: number; openCents: number }; items: Receivable[] }>(`/finance/receivables?${qs}`), placeholderData: keepPreviousData });
  const cancel = useMutation({
    mutationFn: () => api(`/finance/receivables/${cancelling!.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => { invalidateFinance(qc); setCancelling(null); setReason(''); toast.success('Cobrança cancelada'); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: 'OPEN', label: 'Em aberto' }, { value: 'OVERDUE', label: 'Atrasadas' }, { value: 'PAID', label: 'Pagas' }, { value: 'CANCELLED', label: 'Canceladas' }, { value: 'ALL', label: 'Todas' }]} />
        <div className="flex gap-2 pb-2">
          <div className="w-60"><Input leading={<Search className="size-4" />} placeholder="Paciente ou descrição" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {can('finance.write') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nova cobrança</Button>}
        </div>
      </div>
      {q.data && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-slate-100 bg-slate-50/60 px-5 py-2.5 text-sm">
          <span className="text-slate-500">{q.data.total} cobrança(s)</span>
          <span className="text-slate-500">Total <strong className="text-slate-800 tabular">{formatMoney(q.data.totals.amountCents)}</strong></span>
          <span className="text-slate-500">Recebido <strong className="text-emerald-700 tabular">{formatMoney(q.data.totals.paidCents)}</strong></span>
          <span className="text-slate-500">Em aberto <strong className="text-slate-900 tabular">{formatMoney(q.data.totals.openCents)}</strong></span>
        </div>
      )}
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
      {q.data?.items.length === 0 && <EmptyState title="Nenhuma cobrança" description={status === 'OVERDUE' ? 'Nenhum pagamento em atraso.' : undefined} />}
      {!!q.data?.items.length && (
        <div className={clsx('overflow-x-auto', q.isFetching && 'opacity-70')}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500"><th className="px-5 py-2.5">Vencimento</th><th className="px-3 py-2.5">Descrição</th><th className="hidden px-3 py-2.5 md:table-cell">Tipo</th><th className="px-3 py-2.5 text-right">Valor</th><th className="hidden px-3 py-2.5 text-right sm:table-cell">Em aberto</th><th className="px-3 py-2.5">Status</th><th className="px-5 py-2.5" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-5 py-2.5 tabular text-slate-700">{formatDate(r.dueDate)}</td>
                  <td className="max-w-72 px-3 py-2.5">
                    <p className="truncate text-slate-900">{r.description}</p>
                    {r.patient && <Link to={`/pacientes/${r.patient.id}?aba=financeiro`} className="text-xs text-brand-700 hover:underline">{r.patient.name}</Link>}
                  </td>
                  <td className="hidden px-3 py-2.5 text-slate-600 md:table-cell">{KIND_LABELS[r.kind]}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{formatMoney(r.amountCents)}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-medium tabular sm:table-cell">{r.openCents > 0 && r.status !== 'CANCELLED' ? formatMoney(r.openCents) : '—'}</td>
                  <td className="px-3 py-2.5"><PayStatusBadge status={r.status} />{r.method && r.status === 'PAID' && <span className="ml-1.5 text-xs text-slate-500">{PAYMENT_METHOD_LABELS[r.method]}</span>}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right">
                    {can('finance.write') && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(r.status) && (
                      <>
                        <Button size="sm" variant="outline" icon={<Check className="size-3.5" />} onClick={() => setPaying(r)}>Receber</Button>
                        {r.paidCents === 0 && <Button size="sm" variant="ghost" aria-label="Cancelar cobrança" onClick={() => setCancelling(r)}><Ban className="size-4 text-slate-400" /></Button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && <PayModal item={paying} onClose={() => setPaying(null)} />}
      {creating && <ReceivableModal onClose={() => setCreating(false)} />}
      <Modal open={!!cancelling} onClose={() => setCancelling(null)} size="sm" title="Cancelar cobrança?" description={cancelling?.description}
        footer={<><Button variant="outline" onClick={() => setCancelling(null)}>Voltar</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancelar cobrança</Button></>}>
        <Field label="Motivo"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </Card>
  );
}

// ───────────────────────── despesas ─────────────────────────

interface Expense { id: string; description: string; amountCents: number; paidCents: number; openCents: number; dueDate: string; status: string; supplier: string | null; category: { id: string; name: string }; method: string | null }

function Expenses() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const p = usePeriod();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Expense | null>(null);
  const qs = new URLSearchParams({ from: p.from, to: p.to });
  if (status) qs.set('status', status);
  const q = useQuery({ queryKey: ['finance', 'expenses', qs.toString()], queryFn: () => api<{ items: Expense[]; totals: { amountCents: number; paidCents: number; openCents: number } }>(`/finance/expenses?${qs}`), placeholderData: keepPreviousData });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/finance/expenses/${id}/cancel`, { method: 'POST', body: { reason: 'Cancelada pelo usuário' } }), onSuccess: () => { invalidateFinance(qc); toast.success('Despesa cancelada'); }, onError: (e) => toast.error(e.message) });
  return (
    <>
      <PeriodBar p={p} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Todos os status</option><option value="OPEN">A pagar</option><option value="OVERDUE">Atrasadas</option><option value="PAID">Pagas</option><option value="CANCELLED">Canceladas</option>
          </Select>
          {q.data && <p className="text-sm text-slate-500">Total <strong className="text-slate-900">{formatMoney(q.data.totals.amountCents)}</strong> · pago <strong className="text-slate-900">{formatMoney(q.data.totals.paidCents)}</strong> · a pagar <strong className="text-slate-900">{formatMoney(q.data.totals.openCents)}</strong></p>}
          {can('finance.write') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nova despesa</Button>}
        </div>
        {q.isLoading && <LoadingState />}
        {q.data?.items.length === 0 && <EmptyState title="Nenhuma despesa no período" />}
        {!!q.data?.items.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-y border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500"><th className="px-5 py-2.5">Vencimento</th><th className="px-3 py-2.5">Descrição</th><th className="hidden px-3 py-2.5 md:table-cell">Categoria</th><th className="px-3 py-2.5 text-right">Valor</th><th className="px-3 py-2.5">Status</th><th className="px-5 py-2.5" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 tabular">{formatDate(e.dueDate)}</td>
                    <td className="px-3 py-2.5"><p className="text-slate-900">{e.description}</p>{e.supplier && <p className="text-xs text-slate-500">{e.supplier}</p>}</td>
                    <td className="hidden px-3 py-2.5 text-slate-600 md:table-cell">{e.category.name}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{formatMoney(e.amountCents)}</td>
                    <td className="px-3 py-2.5"><PayStatusBadge status={e.status} /></td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right">
                      {can('finance.write') && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(e.status) && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setPaying(e)}>Pagar</Button>
                          {e.paidCents === 0 && <Button size="sm" variant="ghost" aria-label="Cancelar" onClick={() => cancel.mutate(e.id)}><Ban className="size-4 text-slate-400" /></Button>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <ExpenseModal onClose={() => setCreating(false)} />}
      {paying && <PayModal kind="expense" item={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

// ───────────────────────── pacotes ─────────────────────────

export function PackagesList({ rows }: { rows: PackageRow[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((p) => (
        <li key={p.id} className="grid gap-3 px-5 py-3.5 sm:grid-cols-[1.4fr_1fr_1fr] sm:items-center">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">{p.name}
              <Badge tone={p.status === 'ACTIVE' ? (p.remaining <= 2 ? 'amber' : 'green') : p.status === 'COMPLETED' ? 'blue' : 'slate'}>{{ ACTIVE: p.remaining <= 2 ? 'Perto do fim' : 'Ativo', COMPLETED: 'Concluído', EXPIRED: 'Expirado', CANCELLED: 'Cancelado' }[p.status]}</Badge>
            </p>
            <Link to={`/pacientes/${p.patient.id}?aba=financeiro`} className="text-xs text-brand-700 hover:underline">{p.patient.name}</Link>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{p.used} de {p.contracted} sessões</span><span className="font-medium text-slate-800">{p.remaining} restantes</span></div>
            <Meter value={p.used / p.contracted} tone={p.remaining <= 2 && p.status === 'ACTIVE' ? 'warning' : 'brand'} />
          </div>
          <div className="text-xs text-slate-500 sm:text-right">
            <p className="text-sm font-medium text-slate-900 tabular">{formatMoney(p.totalPriceCents)} <span className="font-normal text-slate-500">({formatMoney(p.perSessionCents)}/sessão)</span></p>
            <p>{p.openCents > 0 ? `${formatMoney(p.openCents)} a receber` : 'Quitado'} · início {formatDate(p.startDate)}{p.expectedEndDate && ` · término ${formatDate(p.expectedEndDate)}`}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Packages() {
  const { can } = useAuth();
  const [status, setStatus] = useState('ACTIVE');
  const [selling, setSelling] = useState(false);
  const q = useQuery({ queryKey: ['finance', 'packages', status], queryFn: () => api<PackageRow[]>(`/finance/packages${status ? `?status=${status}` : ''}`) });
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: 'ACTIVE', label: 'Ativos' }, { value: 'COMPLETED', label: 'Concluídos' }, { value: 'CANCELLED', label: 'Cancelados' }, { value: '', label: 'Todos' }]} />
        {can('finance.write') && <div className="pb-2"><Button icon={<Package className="size-4" />} onClick={() => setSelling(true)}>Vender pacote</Button></div>}
      </div>
      {q.isLoading && <LoadingState />}
      {q.data?.length === 0 && <EmptyState icon={<Package className="size-6" />} title="Nenhum pacote" />}
      {q.data && q.data.length > 0 && <div className="border-t border-slate-100"><PackagesList rows={q.data} /></div>}
      {selling && <SellPackageModal onClose={() => setSelling(false)} />}
    </Card>
  );
}

// ───────────────────────── caixa ─────────────────────────

function CashBook() {
  const p = usePeriod();
  const q = useQuery({
    queryKey: ['finance', 'transactions', p.from, p.to],
    queryFn: () => api<{ totals: { inCents: number; outCents: number; balanceCents: number }; items: { id: string; direction: 'IN' | 'OUT'; amountCents: number; method: string; occurredAt: string; description: string | null; patient: { id: string; name: string } | null; category: string | null }[] }>(`/finance/transactions?from=${p.from}&to=${p.to}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PeriodBar p={p} />
      {q.data && (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <StatTile label="Entradas" value={formatMoney(q.data.totals.inCents)} />
          <StatTile label="Saídas" value={formatMoney(q.data.totals.outCents)} />
          <StatTile label="Saldo" value={formatMoney(q.data.totals.balanceCents)} tone={q.data.totals.balanceCents < 0 ? 'bad' : undefined} />
        </div>
      )}
      <Card>
        {q.isLoading && <LoadingState />}
        {q.data?.items.length === 0 && <EmptyState title="Nenhuma movimentação no período" />}
        <ul className="divide-y divide-slate-100">
          {q.data?.items.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-3">
              <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-full', t.direction === 'IN' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>{t.direction === 'IN' ? <ArrowDownRight className="size-4" /> : <ArrowUpRight className="size-4" />}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-900">{t.description}</p>
                <p className="text-xs text-slate-500">{formatDateTime(t.occurredAt)} · {PAYMENT_METHOD_LABELS[t.method]}{t.category && ` · ${t.category}`}</p>
              </div>
              <span className={clsx('text-sm font-semibold tabular', t.direction === 'IN' ? 'text-emerald-700' : 'text-red-700')}>{t.direction === 'IN' ? '+' : '−'} {formatMoney(t.amountCents)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

// ───────────────────────── metas ─────────────────────────

interface GoalItem { metric: 'REVENUE' | 'SESSIONS' | 'NEW_PATIENTS'; target: number | null; realized: number; percent: number | null; projection: number; projectedPercent: number | null }
const GOAL_LABELS = { REVENUE: 'Faturamento', SESSIONS: 'Sessões realizadas', NEW_PATIENTS: 'Novos pacientes' };

export function GoalsPanel({ compactView = false }: { compactView?: boolean }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [month, setMonth] = useState(localDateKey(new Date()).slice(0, 7));
  const q = useQuery({ queryKey: ['finance', 'goals', month], queryFn: () => api<{ items: GoalItem[]; daysElapsed: number; daysInMonth: number }>(`/finance/goals?month=${month}`) });
  const [editing, setEditing] = useState(false);
  const [rev, setRev] = useState<number | null>(null);
  const [ses, setSes] = useState('');
  const [newp, setNewp] = useState('');
  const save = useMutation({
    mutationFn: () => api('/finance/goals', { method: 'PUT', body: { month, revenueCents: rev ?? null, sessions: ses ? Number(ses) : null, newPatients: newp ? Number(newp) : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance', 'goals'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); setEditing(false); toast.success('Metas salvas'); },
    onError: (e) => toast.error(e.message),
  });
  const fmt = (m: GoalItem['metric'], v: number) => (m === 'REVENUE' ? formatMoney(v) : v.toLocaleString('pt-BR'));
  const open = () => {
    const g = (m: string) => q.data?.items.find((i) => i.metric === m)?.target;
    setRev(g('REVENUE') ?? null); setSes(String(g('SESSIONS') ?? '')); setNewp(String(g('NEW_PATIENTS') ?? ''));
    setEditing(true);
  };
  return (
    <Card>
      <CardHeader
        title="Metas do mês"
        description={q.data ? `Dia ${q.data.daysElapsed} de ${q.data.daysInMonth} · a faixa clara mostra a projeção` : undefined}
        actions={<>
          {!compactView && <Input type="month" className="h-9 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />}
          {can('settings.manage') && <Button variant="outline" size="sm" icon={<Target className="size-4" />} onClick={open}>Definir metas</Button>}
        </>}
      />
      {q.isLoading && <LoadingState rows={3} />}
      <ul className="divide-y divide-slate-100">
        {q.data?.items.map((g) => (
          <li key={g.metric} className="px-5 py-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">{GOAL_LABELS[g.metric]}</p>
              <p className="text-sm text-slate-500">
                <strong className="text-base text-slate-900">{fmt(g.metric, g.realized)}</strong>
                {g.target != null ? <> de {fmt(g.metric, g.target)} · <span className="font-medium text-slate-700">{pct(g.percent)}</span></> : ' · sem meta'}
              </p>
            </div>
            {g.target != null && (
              <>
                <Meter value={g.percent ?? 0} projected={g.projectedPercent} tone={(g.percent ?? 0) >= 1 ? 'good' : 'brand'} />
                <p className="mt-1.5 text-xs text-slate-500">Projeção para o fim do mês: {fmt(g.metric, g.projection)} ({pct(g.projectedPercent)})</p>
              </>
            )}
          </li>
        ))}
      </ul>
      <Modal open={editing} onClose={() => setEditing(false)} size="sm" title={`Metas de ${month.split('-').reverse().join('/')}`} description="Deixe em branco para não acompanhar."
        footer={<><Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar metas</Button></>}>
        <div className="space-y-4">
          <Field label="Faturamento mensal"><MoneyInput cents={rev} onChange={setRev} /></Field>
          <Field label="Sessões realizadas"><Input type="number" min={0} value={ses} onChange={(e) => setSes(e.target.value)} /></Field>
          <Field label="Novos pacientes"><Input type="number" min={0} value={newp} onChange={(e) => setNewp(e.target.value)} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

// ───────────────────────── página ─────────────────────────

export function FinancePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    { value: 'visao-geral', label: 'Visão geral', perm: 'finance.reports' },
    { value: 'projecao', label: 'Quanto vou faturar?', perm: 'finance.reports' },
    { value: 'receber', label: 'Contas a receber', perm: 'finance.read' },
    { value: 'despesas', label: 'Despesas', perm: 'finance.reports' },
    { value: 'pacotes', label: 'Pacotes', perm: 'finance.read' },
    { value: 'caixa', label: 'Caixa', perm: 'finance.reports' },
    { value: 'metas', label: 'Metas', perm: 'dashboard.view' },
  ].filter((t) => can(t.perm));
  const tab = tabs.find((t) => t.value === params.get('aba'))?.value ?? tabs[0]?.value;
  return (
    <>
      <PageHeader title="Financeiro" description="Receitas, despesas, pacotes, projeção de faturamento e metas." />
      <div className="mb-6"><Tabs value={tab} onChange={(v) => setParams({ aba: v }, { replace: true })} tabs={tabs} /></div>
      {tab === 'visao-geral' && <Overview />}
      {tab === 'projecao' && <Projection />}
      {tab === 'receber' && <Receivables />}
      {tab === 'despesas' && <Expenses />}
      {tab === 'pacotes' && <Packages />}
      {tab === 'caixa' && <CashBook />}
      {tab === 'metas' && <GoalsPanel />}
    </>
  );
}
