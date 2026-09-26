import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MapPin, Pencil, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { maskCep, maskPhone, PAYMENT_METHOD_LABELS } from '@/lib/format';
import type { DayHours, PaymentMethod, ServiceRow } from '@/lib/types';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Select, Switch } from '@/components/ui';
import { AvailabilityExtras } from './AvailabilityExtras';
import { HoursEditor, hoursErrors, MoneyInput, ServicesEditor, servicesErrors, toServicePayload, weeklyHours, type ServiceDraft } from '@/components/editors';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

interface Settings {
  clinicName: string;
  logoUrl: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  defaultSessionPriceCents: number;
  defaultSessionMinutes: number;
  minBookingNoticeHours: number;
  cancellationNoticeHours: number;
  allowOverbooking: boolean;
  noShowFollowUpDays: number;
  acceptedPaymentMethods: PaymentMethod[];
}

// ───────────────────────── Dados da clínica e regras ─────────────────────────

export function ClinicSettingsPage() {
  const qc = useQueryClient();
  const { reload } = useAuth();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const [v, setV] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);

  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => api<Settings>('/settings', { method: 'PATCH', body }),
    onSuccess: async (data) => {
      qc.setQueryData(['settings'], data);
      await reload();
      toast.success('Configurações salvas');
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading || !v) return <Card>{q.isError ? <ErrorState message={q.error.message} onRetry={() => q.refetch()} /> : <LoadingState />}</Card>;
  const set = <K extends keyof Settings>(k: K, value: Settings[K]) => setV((s) => (s ? { ...s, [k]: value } : s));

  const submitClinic = (e: React.FormEvent) => {
    e.preventDefault();
    if (v.clinicName.trim().length < 2) return toast.error('Informe o nome da clínica');
    save.mutate({
      clinicName: v.clinicName,
      phone: v.phone ?? '',
      whatsapp: v.whatsapp ?? '',
      email: v.email ?? '',
      addressLine: v.addressLine ?? '',
      city: v.city ?? '',
      state: v.state ?? '',
      zipCode: v.zipCode ?? '',
    });
  };

  const submitRules = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.acceptedPaymentMethods.length) return toast.error('Selecione ao menos uma forma de pagamento');
    save.mutate({
      defaultSessionPriceCents: v.defaultSessionPriceCents,
      defaultSessionMinutes: v.defaultSessionMinutes,
      minBookingNoticeHours: v.minBookingNoticeHours,
      cancellationNoticeHours: v.cancellationNoticeHours,
      allowOverbooking: v.allowOverbooking,
      noShowFollowUpDays: v.noShowFollowUpDays,
      acceptedPaymentMethods: v.acceptedPaymentMethods,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Dados da clínica" description="Nome, contato e endereço exibidos aos pacientes." />
        <form onSubmit={submitClinic} className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          <Field label="Nome da clínica" required className="sm:col-span-2">
            <Input value={v.clinicName} onChange={(e) => set('clinicName', e.target.value)} />
          </Field>
          <Field label="Telefone">
            <Input inputMode="tel" value={v.phone ?? ''} onChange={(e) => set('phone', maskPhone(e.target.value))} />
          </Field>
          <Field label="WhatsApp">
            <Input inputMode="tel" value={v.whatsapp ?? ''} onChange={(e) => set('whatsapp', maskPhone(e.target.value))} />
          </Field>
          <Field label="E-mail" className="sm:col-span-2">
            <Input type="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Endereço" className="sm:col-span-2">
            <Input value={v.addressLine ?? ''} onChange={(e) => set('addressLine', e.target.value)} />
          </Field>
          <Field label="Cidade">
            <Input value={v.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <Field label="UF">
              <Select value={v.state ?? ''} onChange={(e) => set('state', e.target.value)}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="CEP">
              <Input inputMode="numeric" value={v.zipCode ?? ''} onChange={(e) => set('zipCode', maskCep(e.target.value))} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={save.isPending}>
              Salvar dados
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Valores e regras de agendamento" description="Padrões usados pela agenda, pelos lembretes e pelas projeções." />
        <form onSubmit={submitRules} className="space-y-6 px-5 py-5">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Valor padrão da sessão">
              <MoneyInput cents={v.defaultSessionPriceCents} onChange={(c) => set('defaultSessionPriceCents', c ?? 0)} />
            </Field>
            <Field label="Duração padrão">
              <Select value={v.defaultSessionMinutes} onChange={(e) => set('defaultSessionMinutes', Number(e.target.value))}>
                {[30, 40, 45, 50, 60, 75, 90].map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Antecedência mínima" hint="Para novos agendamentos.">
              <Select value={v.minBookingNoticeHours} onChange={(e) => set('minBookingNoticeHours', Number(e.target.value))}>
                {[0, 1, 2, 4, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? 'Sem mínimo' : `${h} hora${h > 1 ? 's' : ''}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cancelamento sem cobrança" hint="Até quantas horas antes.">
              <Select value={v.cancellationNoticeHours} onChange={(e) => set('cancellationNoticeHours', Number(e.target.value))}>
                {[0, 2, 6, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? 'A qualquer momento' : `${h} horas`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Contato após falta" hint="Dias sem reagendar até o alerta.">
              <Input type="number" min={1} max={180} value={v.noShowFollowUpDays} onChange={(e) => set('noShowFollowUpDays', Number(e.target.value))} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Permitir encaixe (dois pacientes no mesmo horário)</p>
              <p className="text-xs text-slate-500">Útil para atendimentos em grupo ou equipamentos simultâneos.</p>
            </div>
            <Switch checked={v.allowOverbooking} onChange={(b) => set('allowOverbooking', b)} label="Permitir encaixe" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Formas de pagamento aceitas</p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <Checkbox
                  key={m}
                  label={PAYMENT_METHOD_LABELS[m]}
                  checked={v.acceptedPaymentMethods.includes(m)}
                  onChange={(on) => set('acceptedPaymentMethods', on ? [...v.acceptedPaymentMethods, m] : v.acceptedPaymentMethods.filter((x) => x !== m))}
                />
              ))}
            </div>
          </div>
          <Button type="submit" loading={save.isPending}>
            Salvar regras
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ───────────────────────── Horários ─────────────────────────

export function HoursSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hours'], queryFn: () => api<{ days: DayHours[] }>('/settings/hours') });
  const [days, setDays] = useState<DayHours[] | null>(null);
  useEffect(() => {
    if (q.data) setDays(q.data.days);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (d: DayHours[]) => api<{ days: DayHours[] }>('/settings/hours', { method: 'PUT', body: { days: d } }),
    onSuccess: (data) => {
      qc.setQueryData(['hours'], data);
      toast.success('Horários salvos');
    },
    onError: (e) => toast.error(e.message),
  });

  if (!days) return <Card>{q.isError ? <ErrorState message={q.error.message} onRetry={() => q.refetch()} /> : <LoadingState />}</Card>;
  const invalid = Object.keys(hoursErrors(days)).length > 0 || weeklyHours(days) === 0;
  return (
    <div className="space-y-6">
    <Card>
      <CardHeader
        title="Horários de atendimento"
        description={`Disponibilidade semanal da unidade · ${weeklyHours(days).toLocaleString('pt-BR')} h por semana`}
        actions={
          <Button onClick={() => save.mutate(days)} loading={save.isPending} disabled={invalid}>
            Salvar horários
          </Button>
        }
      />
      <div className="p-5">
        <HoursEditor value={days} onChange={setDays} />
      </div>
    </Card>
    <AvailabilityExtras />
    </div>
  );
}

// ───────────────────────── Serviços ─────────────────────────

export function ServicesSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['services'], queryFn: () => api<ServiceRow[]>('/settings/services') });
  const [list, setList] = useState<ServiceDraft[] | null>(null);
  useEffect(() => {
    if (q.data) setList(q.data.map((s) => ({ ...s })));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (services: ServiceDraft[]) => api<ServiceRow[]>('/settings/services', { method: 'PUT', body: { services: toServicePayload(services) } }),
    onSuccess: (data) => {
      qc.setQueryData(['services'], data);
      toast.success('Serviços salvos');
    },
    onError: (e) => toast.error(e.message),
  });
  if (!list) return <Card>{q.isError ? <ErrorState message={q.error.message} onRetry={() => q.refetch()} /> : <LoadingState />}</Card>;
  const invalid = Object.keys(servicesErrors(list)).length > 0 || list.length === 0;
  return (
    <Card>
      <CardHeader
        title="Serviços e valores"
        description="Serviços removidos são desativados, não apagados — o histórico de atendimentos continua correto."
        actions={
          <Button onClick={() => save.mutate(list)} loading={save.isPending} disabled={invalid}>
            Salvar serviços
          </Button>
        }
      />
      <div className="p-5">
        <ServicesEditor value={list} onChange={setList} />
      </div>
    </Card>
  );
}

// ───────────────────────── Unidades ─────────────────────────

interface UnitRow {
  id: string;
  name: string;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
}

export function UnitsSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['units'], queryFn: () => api<UnitRow[]>('/settings/units') });
  const [editing, setEditing] = useState<Partial<UnitRow> | null>(null);
  const save = useMutation({
    mutationFn: (u: Partial<UnitRow>) => {
      const body = { name: u.name, phone: u.phone ?? '', addressLine: u.addressLine ?? '', city: u.city ?? '', state: u.state ?? '', isActive: u.isActive };
      return u.id ? api(`/settings/units/${u.id}`, { method: 'PATCH', body }) : api('/settings/units', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] });
      setEditing(null);
      toast.success('Unidade salva');
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader
        title="Unidades"
        description="Para clínicas com mais de um endereço. Agenda, atendimentos e financeiro são separados por unidade."
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({ name: '', isActive: true })}>
            Nova unidade
          </Button>
        }
      />
      {q.isLoading && <LoadingState rows={2} />}
      {q.isError && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState title="Nenhuma unidade" />}
      <ul className="divide-y divide-slate-100">
        {q.data?.map((u) => (
          <li key={u.id} className="flex items-center gap-4 px-5 py-3.5">
            <MapPin className="size-5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                {u.name} {!u.isActive && <Badge>Inativa</Badge>}
              </p>
              <p className="truncate text-xs text-slate-500">{[u.addressLine, u.city, u.state].filter(Boolean).join(', ') || 'Endereço não informado'}</p>
            </div>
            <Button variant="ghost" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(u)}>
              Editar
            </Button>
          </li>
        ))}
      </ul>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar unidade' : 'Nova unidade'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={(editing?.name?.trim().length ?? 0) < 2} onClick={() => editing && save.mutate(editing)}>
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">
              <Input autoFocus value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Telefone">
              <Input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: maskPhone(e.target.value) })} />
            </Field>
            <Field label="Cidade">
              <Input value={editing.city ?? ''} onChange={(e) => setEditing({ ...editing, city: e.target.value })} />
            </Field>
            <Field label="Endereço">
              <Input value={editing.addressLine ?? ''} onChange={(e) => setEditing({ ...editing, addressLine: e.target.value })} />
            </Field>
            <Field label="UF">
              <Select value={editing.state ?? ''} onChange={(e) => setEditing({ ...editing, state: e.target.value })}>
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf}>{uf}</option>
                ))}
              </Select>
            </Field>
            {editing.id && (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 sm:col-span-2">
                <span className="text-sm font-medium text-slate-800">Unidade ativa</span>
                <Switch checked={!!editing.isActive} onChange={(b) => setEditing({ ...editing, isActive: b })} label="Unidade ativa" />
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
