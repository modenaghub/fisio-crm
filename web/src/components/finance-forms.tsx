import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatMoney, localDateKey, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { Badge, Button, Field, Input, Modal, Select, Textarea, type BadgeTone } from './ui';
import { MoneyInput } from './editors';
import { PatientPicker, type PickedPatient } from './PatientPicker';

export interface Receivable {
  id: string;
  description: string;
  kind: string;
  amountCents: number;
  paidCents: number;
  openCents: number;
  dueDate: string;
  status: 'PENDING' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'CANCELLED' | 'REFUNDED';
  method: string | null;
  paidAt: string | null;
  installment: number | null;
  installments: number | null;
  notes: string | null;
  patient: { id: string; name: string } | null;
  appointmentAt: string | null;
  package: { name: string } | null;
}

export interface PackageRow {
  id: string;
  name: string;
  patient: { id: string; name: string };
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';
  contracted: number;
  used: number;
  remaining: number;
  scheduled: number;
  totalPriceCents: number;
  perSessionCents: number;
  paidCents: number;
  openCents: number;
  startDate: string;
  expectedEndDate: string | null;
}

export const PAY_STATUS: Record<string, [string, BadgeTone]> = {
  PENDING: ['A vencer', 'blue'],
  PARTIAL: ['Parcial', 'amber'],
  OVERDUE: ['Atrasado', 'red'],
  PAID: ['Pago', 'green'],
  CANCELLED: ['Cancelado', 'slate'],
  REFUNDED: ['Estornado', 'slate'],
};

export const KIND_LABELS: Record<string, string> = { SESSION: 'Sessão', EVALUATION: 'Avaliação', PACKAGE: 'Pacote', OTHER: 'Outros' };

export function PayStatusBadge({ status }: { status: string }) {
  const [label, tone] = PAY_STATUS[status] ?? [status, 'slate'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function useAcceptedMethods() {
  return useQuery({
    queryKey: ['accepted-methods'],
    queryFn: async () => {
      try {
        return (await api<{ acceptedPaymentMethods: string[] }>('/settings')).acceptedPaymentMethods;
      } catch {
        return ['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER'];
      }
    },
    staleTime: 5 * 60_000,
  });
}

export const invalidateFinance = (qc: ReturnType<typeof useQueryClient>) => {
  for (const k of ['finance', 'patient', 'patients', 'patient-packages', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
};

/** Registrar recebimento (total ou parcial). Também serve para pagar despesas (`kind="expense"`). */
export function PayModal({ item, kind = 'receivable', onClose }: { item: { id: string; description: string; openCents: number }; kind?: 'receivable' | 'expense'; onClose: () => void }) {
  const qc = useQueryClient();
  const methods = useAcceptedMethods();
  const [amount, setAmount] = useState<number | null>(item.openCents);
  const [method, setMethod] = useState('PIX');
  const [date, setDate] = useState(localDateKey(new Date()));
  useEffect(() => { if (methods.data && !methods.data.includes(method)) setMethod(methods.data[0]); }, [methods.data, method]);
  const over = (amount ?? 0) > item.openCents;
  const save = useMutation({
    mutationFn: () => {
      const paidAt = date === localDateKey(new Date()) ? new Date().toISOString() : new Date(`${date}T12:00:00-03:00`).toISOString();
      return api(kind === 'expense' ? `/finance/expenses/${item.id}/pay` : `/finance/receivables/${item.id}/pay`, { method: 'POST', body: { amountCents: amount, method, paidAt } });
    },
    onSuccess: () => { invalidateFinance(qc); toast.success(kind === 'expense' ? 'Pagamento registrado' : 'Recebimento registrado'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const list = kind === 'expense' ? Object.keys(PAYMENT_METHOD_LABELS) : methods.data ?? [];
  return (
    <Modal open onClose={onClose} size="sm" title={kind === 'expense' ? 'Pagar despesa' : 'Registrar recebimento'} description={item.description}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!amount || over} loading={save.isPending} onClick={() => save.mutate()}>Confirmar</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Em aberto: <strong className="text-slate-900">{formatMoney(item.openCents)}</strong></p>
        <Field label="Valor" error={over ? 'Maior que o saldo em aberto' : undefined} hint="Informe um valor menor para registrar um pagamento parcial.">
          <MoneyInput cents={amount} onChange={setAmount} invalid={over} />
        </Field>
        <Field label="Forma de pagamento">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>{list.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</Select>
        </Field>
        <Field label="Data"><Input type="date" max={localDateKey(new Date())} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function SellPackageModal({ patient, onClose }: { patient?: PickedPatient; onClose: () => void }) {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['finance', 'templates'], queryFn: () => api<{ id: string; name: string; sessions: number; priceCents: number; validityDays: number | null; isActive: boolean }[]>('/finance/package-templates') });
  const methods = useAcceptedMethods();
  const [who, setWho] = useState<PickedPatient | null>(patient ?? null);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState(10);
  const [total, setTotal] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(localDateKey(new Date()));
  const [installments, setInstallments] = useState(1);
  const [firstDue, setFirstDue] = useState(localDateKey(new Date()));
  const [paidNow, setPaidNow] = useState('');
  useEffect(() => {
    const t = templates.data?.find((x) => x.id === templateId);
    if (t) { setName(t.name); setSessions(t.sessions); setTotal(t.priceCents); }
  }, [templateId, templates.data]);
  useEffect(() => { if (!templateId && templates.data?.length) setTemplateId(templates.data.find((t) => t.isActive)?.id ?? ''); }, [templates.data, templateId]);
  const invalid = !who || name.trim().length < 2 || !sessions || total == null;
  const save = useMutation({
    mutationFn: () => api(`/patients/${who!.id}/packages`, { method: 'POST', body: { templateId: templateId || undefined, name, sessions, totalPriceCents: total, startDate, installments, firstDueDate: firstDue, paidNowMethod: paidNow || undefined } }),
    onSuccess: () => { invalidateFinance(qc); toast.success('Pacote vendido'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const per = total && sessions ? Math.round(total / sessions) : 0;
  return (
    <Modal open onClose={onClose} title="Vender pacote de sessões" description="Cada sessão realizada desconta automaticamente uma sessão do pacote."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Vender pacote</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!patient && <Field label="Paciente" required className="sm:col-span-2"><PatientPicker value={who} onChange={setWho} autoFocus /></Field>}
        <Field label="Modelo" className="sm:col-span-2" hint={templates.data?.length === 0 ? 'Cadastre modelos em Configurações › Serviços e valores.' : undefined}>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Personalizado</option>
            {templates.data?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.sessions} sessões · {formatMoney(t.priceCents)}</option>)}
          </Select>
        </Field>
        <Field label="Nome do pacote" required className="sm:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Sessões"><Input type="number" min={1} max={500} value={sessions} onChange={(e) => setSessions(Number(e.target.value))} /></Field>
        <Field label="Valor total" hint={per ? `${formatMoney(per)} por sessão` : undefined}><MoneyInput cents={total} onChange={setTotal} /></Field>
        <Field label="Início"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="Parcelas">
          <Select value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x de ${formatMoney(Math.floor((total ?? 0) / n))}`}</option>)}
          </Select>
        </Field>
        <Field label={installments > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento'}><Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
        <Field label="Recebido agora?">
          <Select value={paidNow} onChange={(e) => setPaidNow(e.target.value)}>
            <option value="">Não, fica a receber</option>
            {methods.data?.map((m) => <option key={m} value={m}>Sim, {PAYMENT_METHOD_LABELS[m]}{installments > 1 ? ' (1ª parcela)' : ''}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

export function ReceivableModal({ patient, onClose }: { patient?: PickedPatient; onClose: () => void }) {
  const qc = useQueryClient();
  const [who, setWho] = useState<PickedPatient | null>(patient ?? null);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('OTHER');
  const [amount, setAmount] = useState<number | null>(null);
  const [due, setDue] = useState(localDateKey(new Date()));
  const [notes, setNotes] = useState('');
  const save = useMutation({
    mutationFn: () => api('/finance/receivables', { method: 'POST', body: { patientId: who?.id, description, kind, amountCents: amount, dueDate: due, notes } }),
    onSuccess: () => { invalidateFinance(qc); toast.success('Cobrança lançada'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="Nova cobrança" footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={description.trim().length < 2 || !amount} loading={save.isPending} onClick={() => save.mutate()}>Lançar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!patient && <Field label="Paciente (opcional)" className="sm:col-span-2"><PatientPicker value={who} onChange={setWho} /></Field>}
        <Field label="Descrição" required className="sm:col-span-2"><Input autoFocus={!!patient} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Avaliação domiciliar, relatório" /></Field>
        <Field label="Tipo"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Valor" required><MoneyInput cents={amount} onChange={setAmount} /></Field>
        <Field label="Vencimento"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Observações" className="sm:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function ExpenseModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['finance', 'categories'], queryFn: () => api<{ id: string; name: string }[]>('/finance/expense-categories') });
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [due, setDue] = useState(localDateKey(new Date()));
  const [supplier, setSupplier] = useState('');
  const [repeat, setRepeat] = useState(1);
  const [paidNow, setPaidNow] = useState('');
  useEffect(() => { if (!categoryId && cats.data?.length) setCategoryId(cats.data[0].id); }, [cats.data, categoryId]);
  const save = useMutation({
    mutationFn: () => api('/finance/expenses', { method: 'POST', body: { categoryId, description, amountCents: amount, dueDate: due, supplier, repeatMonths: repeat, paidNowMethod: paidNow || undefined } }),
    onSuccess: () => { invalidateFinance(qc); toast.success('Despesa lançada'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="Nova despesa" footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!categoryId || description.trim().length < 2 || !amount} loading={save.isPending} onClick={() => save.mutate()}>Lançar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoria"><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Valor" required><MoneyInput cents={amount} onChange={setAmount} /></Field>
        <Field label="Descrição" required className="sm:col-span-2"><Input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Aluguel da sala, compra de faixas elásticas" /></Field>
        <Field label="Fornecedor"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Vencimento"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Repetir">
          <Select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
            <option value={1}>Não repetir</option>
            {[3, 6, 12].map((n) => <option key={n} value={n}>Todo mês, por {n} meses</option>)}
          </Select>
        </Field>
        <Field label="Já pago?">
          <Select value={paidNow} onChange={(e) => setPaidNow(e.target.value)}>
            <option value="">Não, fica a pagar</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>Sim, {l}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
