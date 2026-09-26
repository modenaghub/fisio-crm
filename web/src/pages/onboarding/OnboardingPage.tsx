import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CircleDollarSign,
  ImagePlus,
  Landmark,
  MessageCircle,
  Phone,
  PartyPopper,
  Stethoscope,
  Tags,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { maskCep, maskPhone, PAYMENT_METHOD_LABELS } from '@/lib/format';
import type { DayHours, PaymentMethod, ServiceRow } from '@/lib/types';
import { Alert, Button, Checkbox, ErrorState, Field, Input, Select, Spinner } from '@/components/ui';
import { HoursEditor, hoursErrors, MoneyInput, PRESET_HOURS, ServicesEditor, servicesErrors, toServicePayload, weeklyHours, type ServiceDraft } from '@/components/editors';
import { Logo } from '@/layouts/AuthLayout';

interface OnboardingState {
  completed: boolean;
  currentStep: number;
  data: {
    1: { clinicName: string };
    2: { name: string; crefito: string; specialties: string[] };
    3: { logoDataUrl: string | null };
    4: { phone: string; email: string; addressLine: string; city: string; state: string; zipCode: string };
    5: { unitId: string; days: DayHours[] };
    6: { defaultSessionPriceCents: number; defaultSessionMinutes: number; evaluationPriceCents: number | null };
    7: { services: ServiceRow[] };
    8: { whatsapp: string; integrationStatus: string };
    9: { acceptedPaymentMethods: PaymentMethod[]; expenseCategories: string[] };
  };
}

const STEPS = [
  { n: 1, title: 'Nome da clínica', icon: Building2 },
  { n: 2, title: 'Fisioterapeuta', icon: Stethoscope },
  { n: 3, title: 'Logo', icon: ImagePlus, optional: true },
  { n: 4, title: 'Telefone e endereço', icon: Phone },
  { n: 5, title: 'Horários de atendimento', icon: CalendarClock },
  { n: 6, title: 'Valor da sessão', icon: CircleDollarSign },
  { n: 7, title: 'Serviços', icon: Tags },
  { n: 8, title: 'WhatsApp', icon: MessageCircle, optional: true },
  { n: 9, title: 'Financeiro', icon: Landmark },
] as const;

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

type StepProps<K extends keyof OnboardingState['data']> = {
  initial: OnboardingState['data'][K];
  save: (body: unknown) => Promise<void>;
  saving: boolean;
  back?: () => void;
  skip?: () => void;
};

function StepShell({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-slate-500">{description}</p>}
      <div className="mt-8">{children}</div>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6">{footer}</div>
    </div>
  );
}

function Nav({ back, skip, saving, disabled, label = 'Salvar e continuar' }: { back?: () => void; skip?: () => void; saving: boolean; disabled?: boolean; label?: string }) {
  return (
    <>
      <div>
        {back && (
          <Button type="button" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={back}>
            Voltar
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        {skip && (
          <Button type="button" variant="outline" onClick={skip}>
            Pular
          </Button>
        )}
        <Button type="submit" loading={saving} disabled={disabled}>
          {label} <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  );
}

// ───────────────────────── Etapas ─────────────────────────

function Step1({ initial, save, saving }: StepProps<1>) {
  const [name, setName] = useState(initial.clinicName);
  const invalid = name.trim().length < 2;
  return (
    <form onSubmit={(e) => (e.preventDefault(), !invalid && save({ clinicName: name }))}>
      <StepShell title="Como se chama sua clínica?" description="Esse nome aparece no sistema, nas mensagens aos pacientes e nos documentos." footer={<Nav saving={saving} disabled={invalid} />}>
        <Field label="Nome da clínica ou consultório" required htmlFor="c">
          <Input id="c" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </StepShell>
    </form>
  );
}

function Step2({ initial, save, saving, back }: StepProps<2>) {
  const [name, setName] = useState(initial.name);
  const [crefito, setCrefito] = useState(initial.crefito);
  const [specialties, setSpecialties] = useState(initial.specialties.join(', '));
  const invalid = name.trim().length < 3;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save({ name, crefito, specialties: specialties.split(',').map((s) => s.trim()).filter(Boolean) });
      }}
    >
      <StepShell title="Quem é o fisioterapeuta responsável?" description="Você pode cadastrar outros profissionais depois, em Configurações › Usuários." footer={<Nav back={back} saving={saving} disabled={invalid} />}>
        <div className="space-y-5">
          <Field label="Nome completo" required htmlFor="n">
            <Input id="n" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="CREFITO" hint="Aparece em documentos e evoluções." htmlFor="cr">
              <Input id="cr" placeholder="Ex.: 123456-F" value={crefito} onChange={(e) => setCrefito(e.target.value)} />
            </Field>
            <Field label="Especialidades" hint="Separe por vírgula." htmlFor="sp">
              <Input id="sp" placeholder="Ortopedia, Neurologia…" value={specialties} onChange={(e) => setSpecialties(e.target.value)} />
            </Field>
          </div>
        </div>
      </StepShell>
    </form>
  );
}

function Step3({ initial, save, saving, back, skip }: StepProps<3>) {
  const [logo, setLogo] = useState<string | null>(initial.logoDataUrl);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function pick(file?: File) {
    setError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setError('Use uma imagem PNG, JPG ou WebP.');
    if (file.size > 300 * 1024) return setError('A imagem deve ter no máximo 300 KB.');
    const reader = new FileReader();
    reader.onload = () => setLogo(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <form onSubmit={(e) => (e.preventDefault(), save({ logoDataUrl: logo }))}>
      <StepShell title="Adicione o logo da clínica" description="Opcional. Aparece no menu do sistema e, futuramente, nos documentos." footer={<Nav back={back} skip={skip} saving={saving} />}>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0]);
          }}
          className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center"
        >
          {logo ? (
            <img src={logo} alt="Logo da clínica" className="size-28 rounded-xl object-contain ring-1 ring-slate-200" />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <ImagePlus className="size-7" />
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-slate-800">Arraste uma imagem ou</p>
            <p className="text-xs text-slate-500">PNG, JPG ou WebP · até 300 KB · de preferência quadrada</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
              Escolher arquivo
            </Button>
            {logo && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setLogo(null)}>
                Remover
              </Button>
            )}
          </div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        </div>
      </StepShell>
    </form>
  );
}

function Step4({ initial, save, saving, back }: StepProps<4>) {
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof v, value: string) => setV((s) => ({ ...s, [k]: value }));
  const phoneInvalid = v.phone.replace(/\D/g, '').length < 10;
  return (
    <form onSubmit={(e) => (e.preventDefault(), !phoneInvalid && save(v))}>
      <StepShell title="Telefone e endereço" description="Os dados de contato que seus pacientes verão." footer={<Nav back={back} saving={saving} disabled={phoneInvalid} />}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Telefone" required htmlFor="ph" error={v.phone && phoneInvalid ? 'Telefone incompleto' : undefined}>
            <Input id="ph" autoFocus inputMode="tel" placeholder="(00) 0000-0000" value={v.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} />
          </Field>
          <Field label="E-mail da clínica" htmlFor="em">
            <Input id="em" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Endereço" className="sm:col-span-2" htmlFor="ad">
            <Input id="ad" placeholder="Rua, número, complemento" value={v.addressLine} onChange={(e) => set('addressLine', e.target.value)} />
          </Field>
          <Field label="Cidade" htmlFor="ci">
            <Input id="ci" value={v.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <Field label="UF" htmlFor="uf">
              <Select id="uf" value={v.state} onChange={(e) => set('state', e.target.value)}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="CEP" htmlFor="cep">
              <Input id="cep" inputMode="numeric" placeholder="00000-000" value={v.zipCode} onChange={(e) => set('zipCode', maskCep(e.target.value))} />
            </Field>
          </div>
        </div>
      </StepShell>
    </form>
  );
}

function Step5({ initial, save, saving, back }: StepProps<5>) {
  const hasAny = initial.days.some((d) => d.intervals.length);
  const [days, setDays] = useState<DayHours[]>(hasAny ? initial.days : PRESET_HOURS);
  const errors = hoursErrors(days);
  const total = weeklyHours(days);
  const invalid = Object.keys(errors).length > 0 || total === 0;
  return (
    <form onSubmit={(e) => (e.preventDefault(), !invalid && save({ days }))}>
      <StepShell
        title="Horários de atendimento"
        description="Base da agenda e do cálculo de ocupação. Folgas, feriados e férias você cadastra depois, na agenda."
        footer={<Nav back={back} saving={saving} disabled={invalid} />}
      >
        <HoursEditor value={days} onChange={setDays} />
        <p className="mt-3 text-sm text-slate-500">
          Total: <strong className="text-slate-800">{total.toLocaleString('pt-BR')} horas por semana</strong>
        </p>
      </StepShell>
    </form>
  );
}

function Step6({ initial, save, saving, back }: StepProps<6>) {
  const [price, setPrice] = useState<number | null>(initial.defaultSessionPriceCents || null);
  const [minutes, setMinutes] = useState(initial.defaultSessionMinutes);
  const [evalPrice, setEvalPrice] = useState<number | null>(initial.evaluationPriceCents);
  const invalid = price == null || minutes < 10;
  return (
    <form onSubmit={(e) => (e.preventDefault(), !invalid && save({ defaultSessionPriceCents: price, defaultSessionMinutes: minutes, evaluationPriceCents: evalPrice ?? undefined }))}>
      <StepShell title="Quanto custa uma sessão?" description="Usado como padrão nos agendamentos e nas projeções de faturamento. Pacotes de sessões são configurados no módulo Financeiro." footer={<Nav back={back} saving={saving} disabled={invalid} />}>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Valor da sessão" required htmlFor="pr">
            <MoneyInput id="pr" cents={price} onChange={setPrice} />
          </Field>
          <Field label="Duração da sessão" required htmlFor="du">
            <Select id="du" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[30, 40, 45, 50, 60, 75, 90].map((m) => (
                <option key={m} value={m}>
                  {m} minutos
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor da avaliação" hint="Deixe em branco se não cobrar à parte." htmlFor="ev">
            <MoneyInput id="ev" cents={evalPrice} onChange={setEvalPrice} />
          </Field>
        </div>
      </StepShell>
    </form>
  );
}

function Step7({ initial, save, saving, back }: StepProps<7>) {
  const [list, setList] = useState<ServiceDraft[]>(
    initial.services.length ? initial.services.map((s) => ({ ...s })) : [{ name: 'Sessão de fisioterapia', kind: 'SESSION', durationMinutes: 50, priceCents: null }],
  );
  const invalid = Object.keys(servicesErrors(list)).length > 0;
  return (
    <form onSubmit={(e) => (e.preventDefault(), !invalid && save({ services: toServicePayload(list) }))}>
      <StepShell title="Quais serviços você oferece?" description="Ex.: avaliação, sessão, RPG, pilates clínico, drenagem, atendimento domiciliar." footer={<Nav back={back} saving={saving} disabled={invalid} />}>
        <ServicesEditor value={list} onChange={setList} />
      </StepShell>
    </form>
  );
}

function Step8({ initial, save, saving, back, skip }: StepProps<8>) {
  const [phone, setPhone] = useState(initial.whatsapp);
  return (
    <form onSubmit={(e) => (e.preventDefault(), save({ whatsapp: phone }))}>
      <StepShell title="WhatsApp da clínica" description="O número que enviará lembretes e receberá novos contatos." footer={<Nav back={back} skip={skip} saving={saving} />}>
        <div className="space-y-5">
          <Field label="Número do WhatsApp" htmlFor="wa">
            <Input id="wa" inputMode="tel" placeholder="(00) 00000-0000" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
          </Field>
          <Alert tone="blue" icon={<MessageCircle className="size-4" />} title="Conexão oficial em uma próxima etapa">
            A integração usa a WhatsApp Business Platform (API oficial da Meta), que exige conta Meta Business verificada e um número dedicado. Até lá, as mensagens
            automáticas funcionam em modo demonstração, sem enviar nada aos pacientes.
          </Alert>
        </div>
      </StepShell>
    </form>
  );
}

function Step9({ initial, save, saving, back }: StepProps<9>) {
  const [methods, setMethods] = useState<PaymentMethod[]>(initial.acceptedPaymentMethods);
  const [categories, setCategories] = useState<string[]>(initial.expenseCategories);
  const [newCat, setNewCat] = useState('');
  const toggle = (m: PaymentMethod, on: boolean) => setMethods((s) => (on ? [...s, m] : s.filter((x) => x !== m)));
  return (
    <form onSubmit={(e) => (e.preventDefault(), methods.length && save({ acceptedPaymentMethods: methods, expenseCategories: categories }))}>
      <StepShell title="Configuração financeira" description="Formas de pagamento aceitas e categorias de despesas." footer={<Nav back={back} saving={saving} disabled={!methods.length} label="Concluir" />}>
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Formas de pagamento</h3>
            <div className="mt-3 space-y-2.5">
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <Checkbox key={m} checked={methods.includes(m)} onChange={(on) => toggle(m, on)} label={PAYMENT_METHOD_LABELS[m]} />
              ))}
            </div>
            {!methods.length && <p className="mt-2 text-xs font-medium text-red-600">Selecione ao menos uma.</p>}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Categorias de despesa</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {categories.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-700">
                  {c}
                  <button type="button" onClick={() => setCategories((s) => s.filter((x) => x !== c))} className="rounded-full px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={`Remover ${c}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Input
                placeholder="Nova categoria"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newCat.trim();
                    if (v && !categories.some((c) => c.toLowerCase() === v.toLowerCase())) setCategories((s) => [...s, v]);
                    setNewCat('');
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const v = newCat.trim();
                  if (v && !categories.some((c) => c.toLowerCase() === v.toLowerCase())) setCategories((s) => [...s, v]);
                  setNewCat('');
                }}
              >
                Adicionar
              </Button>
            </div>
          </div>
        </div>
      </StepShell>
    </form>
  );
}

// ───────────────────────── Página ─────────────────────────

export function OnboardingPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { reload, me } = useAuth();
  const q = useQuery({ queryKey: ['onboarding'], queryFn: () => api<OnboardingState>('/onboarding') });
  const [step, setStep] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (q.data && step === null) setStep(Math.min(9, Math.max(1, q.data.currentStep + 1)));
  }, [q.data, step]);

  const saveStep = useMutation({
    mutationFn: ({ n, body }: { n: number; body: unknown }) => api<OnboardingState>(`/onboarding/steps/${n}`, { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(['onboarding'], data),
  });
  const complete = useMutation({ mutationFn: () => api('/onboarding/complete', { method: 'POST' }) });

  const next = async (n: number, body: unknown) => {
    try {
      await saveStep.mutateAsync({ n, body });
      if (n < 9) return setStep(n + 1);
      await complete.mutateAsync();
      await reload();
      setDone(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const content = useMemo(() => {
    if (!q.data || step === null) return null;
    const d = q.data.data;
    const common = { saving: saveStep.isPending || complete.isPending, back: step > 1 ? () => setStep(step - 1) : undefined, skip: () => setStep(step + 1) };
    const save = (body: unknown) => next(step, body);
    switch (step) {
      case 1: return <Step1 key={1} initial={d[1]} save={save} {...common} />;
      case 2: return <Step2 key={2} initial={d[2]} save={save} {...common} />;
      case 3: return <Step3 key={3} initial={d[3]} save={save} {...common} />;
      case 4: return <Step4 key={4} initial={d[4]} save={save} {...common} />;
      case 5: return <Step5 key={5} initial={d[5]} save={save} {...common} />;
      case 6: return <Step6 key={6} initial={d[6]} save={save} {...common} />;
      case 7: return <Step7 key={7} initial={d[7]} save={save} {...common} />;
      case 8: return <Step8 key={8} initial={d[8]} save={save} {...common} />;
      case 9: return <Step9 key={9} initial={d[9]} save={save} {...common} />;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, step, saveStep.isPending, complete.isPending]);

  if (done) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg shadow-brand-900/20">
            <PartyPopper className="size-8" />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">Seu sistema está pronto.</h1>
          <p className="mt-3 text-slate-600">
            {me?.organization.clinicName} já tem horários, serviços e valores configurados. Tudo pode ser ajustado depois em Configurações.
          </p>
          <Button size="lg" className="mt-8" onClick={() => navigate('/', { replace: true })}>
            Ir para o painel <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Logo />
          {q.data?.completed && (
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              Sair da configuração
            </Button>
          )}
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-8 lg:grid-cols-[220px_1fr] lg:py-12">
        {/* Progresso */}
        <nav aria-label="Etapas" className="lg:sticky lg:top-8 lg:self-start">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Primeiro acesso · {step ?? 1} de 9</p>
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-200 lg:hidden">
            <div className="h-full bg-brand-700 transition-all" style={{ width: `${((step ?? 1) / 9) * 100}%` }} />
          </div>
          <ol className="hidden space-y-1 lg:block">
            {STEPS.map((s) => {
              const reached = (q.data?.currentStep ?? 0) >= s.n;
              const active = step === s.n;
              return (
                <li key={s.n}>
                  <button
                    type="button"
                    disabled={!reached && !active && s.n > (q.data?.currentStep ?? 0) + 1}
                    onClick={() => setStep(s.n)}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-default',
                      active ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800',
                    )}
                  >
                    <span
                      className={clsx(
                        'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        reached && !active ? 'bg-brand-700 text-white' : active ? 'bg-brand-100 text-brand-800' : 'bg-slate-200 text-slate-500',
                      )}
                    >
                      {reached && !active ? <Check className="size-3.5" /> : s.n}
                    </span>
                    {s.title}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="min-w-0">
          {q.isLoading && (
            <div className="flex justify-center py-20">
              <Spinner className="size-7" />
            </div>
          )}
          {q.isError && <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />}
          {content}
        </main>
      </div>
    </div>
  );
}
