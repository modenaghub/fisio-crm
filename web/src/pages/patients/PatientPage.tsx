import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
  ArrowLeft,
  CalendarCheck2,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Package,
  Pencil,
  Phone,
  Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatDayTime, formatMoney, whatsappLink } from '@/lib/format';
import { LEAD_SOURCES, PATIENT_STAGES, SEX_LABELS, STAGE_LABELS, STAGE_TONES } from '@/lib/labels';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Select, Skeleton, Spinner } from '@/components/ui';
import { PatientFormModal } from '@/components/crm-forms';

export interface PatientDetail {
  id: string;
  code: string;
  name: string;
  socialName: string | null;
  cpf: string | null;
  birthDate: string | null;
  age: number | null;
  sex: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  photoUrl: string | null;
  profession: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  source: string;
  crmStage: string;
  responsible: { id: string; name: string } | null;
  lastContactAt: string | null;
  notes: string | null;
  createdAt: string;
  nextAppointment: { startsAt: string; service: string | null } | null;
  lastSessionAt: string | null;
  sessionsDone: number;
  activePackage: { id: string; name: string; contracted: number; used: number; remaining: number; totalPriceCents: number } | null;
  balanceDueCents: number;
  lead: { id: string; firstContactAt: string; source: string } | null;
  canSeeClinical: boolean;
}

// Abas carregadas sob demanda (cada módulo em seu arquivo).
const ClinicalTab = lazy(() => import('./tabs/ClinicalTab'));
const EvaluationsTab = lazy(() => import('./tabs/EvaluationsTab'));
const TreatmentTab = lazy(() => import('./tabs/TreatmentTab'));
const EvolutionsTab = lazy(() => import('./tabs/EvolutionsTab'));
const ScheduleTab = lazy(() => import('./tabs/ScheduleTab'));
const FinanceTab = lazy(() => import('./tabs/FinanceTab'));
const MessagesTab = lazy(() => import('./tabs/MessagesTab'));
const DocumentsTab = lazy(() => import('./tabs/DocumentsTab'));

type TabDef = { key: string; label: string; permission?: string; render: (p: PatientDetail) => ReactNode };

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function DataTab({ p }: { p: PatientDetail }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Dados pessoais" />
        <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Nome completo" value={p.name} />
          <Info label="Nome social" value={p.socialName} />
          <Info label="CPF" value={p.cpf} />
          <Info label="Data de nascimento" value={p.birthDate && `${formatDate(p.birthDate)} (${p.age} anos)`} />
          <Info label="Sexo" value={SEX_LABELS[p.sex]} />
          <Info label="Profissão" value={p.profession} />
          <Info label="Telefone" value={p.phone} />
          <Info label="WhatsApp" value={p.whatsapp} />
          <Info label="E-mail" value={p.email} />
          <Info label="Endereço" value={[p.addressLine, p.city && `${p.city}${p.state ? `/${p.state}` : ''}`, p.zipCode].filter(Boolean).join(' · ')} />
          <Info label="Contato de emergência" value={p.emergencyContactName && `${p.emergencyContactName}${p.emergencyContactPhone ? ` · ${p.emergencyContactPhone}` : ''}`} />
          <Info label="Como conheceu a clínica" value={LEAD_SOURCES[p.source]} />
          <Info label="Responsável" value={p.responsible?.name} />
          <Info label="Cadastrado em" value={formatDate(p.createdAt)} />
          {p.lead && <Info label="Primeiro contato" value={formatDateTime(p.lead.firstContactAt)} />}
        </dl>
        {p.notes && <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-600"><span className="font-medium text-slate-800">Observações: </span>{p.notes}</p>}
      </Card>
      {p.canSeeClinical && (
        <Suspense fallback={<Spinner />}>
          <ClinicalTab patient={p} />
        </Suspense>
      )}
    </div>
  );
}

interface TimelineEvent { at: string; type: string; title: string; detail?: string | null }

const EVENT_STYLE: Record<string, string> = {
  first_contact: 'bg-blue-500', converted: 'bg-brand-600', created: 'bg-brand-600', stage: 'bg-slate-400', evaluation: 'bg-violet-500', plan: 'bg-violet-500',
  session: 'bg-emerald-500', payment: 'bg-amber-500', appointment_scheduled: 'bg-sky-400', appointment_cancelled: 'bg-red-400', appointment_no_show: 'bg-red-500',
};

export function TimelineTab({ patientId }: { patientId: string }) {
  const q = useQuery({ queryKey: ['patient', patientId, 'timeline'], queryFn: () => api<{ events: TimelineEvent[] }>(`/patients/${patientId}/timeline`) });
  if (q.isLoading) return <Card><div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div></Card>;
  if (q.isError) return <Card><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></Card>;
  if (!q.data?.events.length) return <Card><EmptyState title="Nenhum acontecimento ainda" /></Card>;
  return (
    <Card className="p-5">
      <ol className="relative space-y-5 border-l-2 border-slate-100 pl-6">
        {q.data.events.map((e, i) => (
          <li key={i} className="relative">
            <span className={clsx('absolute -left-[31px] top-1 size-3.5 rounded-full ring-4 ring-white', EVENT_STYLE[e.type] ?? 'bg-slate-300')} />
            <p className="text-xs font-medium text-slate-500 tabular">{formatDateTime(e.at)}</p>
            <p className="text-sm font-medium text-slate-900">{e.title}</p>
            {e.detail && <p className="text-sm text-slate-500">{e.detail}</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function SideStat({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-5 py-3.5">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="text-sm font-medium text-slate-900">{children}</div>
      </div>
    </div>
  );
}

export function PatientPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [menu, setMenu] = useState(false);
  const q = useQuery({ queryKey: ['patient', id], queryFn: () => api<PatientDetail>(`/patients/${id}`) });

  const stage = useMutation({
    mutationFn: (s: string) => api(`/patients/${id}/stage`, { method: 'PATCH', body: { stage: s } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', id] });
      qc.invalidateQueries({ queryKey: ['crm-board'] });
      toast.success('Status atualizado');
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/patients/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success('Paciente excluído');
      navigate('/pacientes');
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="flex justify-center py-24"><Spinner className="size-7" /></div>;
  if (q.isError || !q.data) return <Card><ErrorState message={q.error?.message} onRetry={() => q.refetch()} /></Card>;
  const p = q.data;

  const allTabs: TabDef[] = [
    { key: 'dados', label: 'Dados', render: (x) => <DataTab p={x} /> },
    { key: 'avaliacao', label: 'Avaliação', permission: 'clinical.read', render: (x) => <EvaluationsTab patient={x} /> },
    { key: 'tratamento', label: 'Tratamento', permission: 'clinical.read', render: (x) => <TreatmentTab patient={x} /> },
    { key: 'evolucoes', label: 'Evoluções', permission: 'clinical.read', render: (x) => <EvolutionsTab patient={x} /> },
    { key: 'agenda', label: 'Agenda', permission: 'schedule.read', render: (x) => <ScheduleTab patient={x} /> },
    { key: 'financeiro', label: 'Financeiro', permission: 'finance.read', render: (x) => <FinanceTab patient={x} /> },
    { key: 'comunicacao', label: 'Comunicação', permission: 'messages.read', render: (x) => <MessagesTab patient={x} /> },
    { key: 'documentos', label: 'Documentos', permission: 'documents.read', render: (x) => <DocumentsTab patient={x} /> },
    { key: 'linha-do-tempo', label: 'Linha do tempo', render: (x) => <TimelineTab patientId={x.id} /> },
  ];
  const tabs = allTabs.filter((t) => !t.permission || can(t.permission));
  const active = tabs.find((t) => t.key === params.get('aba')) ?? tabs[0];
  const wa = whatsappLink(p.whatsapp ?? p.phone);

  return (
    <>
      <Link to="/pacientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Pacientes
      </Link>

      {/* Cabeçalho: foto, nome, status, idade, telefone, próxima sessão */}
      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={p.name} src={p.photoUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{p.socialName ?? p.name}</h1>
              <Badge tone={STAGE_TONES[p.crmStage]}>{STAGE_LABELS[p.crmStage]}</Badge>
              <span className="text-xs font-medium text-slate-400">{p.code}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
              {p.age !== null && <span>{p.age} anos</span>}
              {(p.whatsapp || p.phone) && <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{p.whatsapp ?? p.phone}</span>}
              {p.email && <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{p.email}</span>}
              <span className="inline-flex items-center gap-1.5 font-medium text-brand-700">
                <CalendarClock className="size-3.5" />
                {p.nextAppointment ? `Próxima sessão: ${formatDayTime(p.nextAppointment.startsAt)}` : 'Sem sessão agendada'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            {can('patients.write') && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>}
            {can('patients.delete') && (
              <div className="relative">
                <Button variant="ghost" aria-label="Mais ações" onClick={() => setMenu((m) => !m)} onBlur={() => setTimeout(() => setMenu(false), 150)}>
                  <MoreHorizontal className="size-5" />
                </Button>
                {menu && (
                  <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setMenu(false); setRemoving(true); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                      <Trash2 className="size-4" /> Excluir paciente
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <div className="mb-5 -mx-1 overflow-x-auto px-1">
            <nav className="inline-flex w-max min-w-full gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active.key === t.key}
                  onClick={() => setParams({ aba: t.key }, { replace: true })}
                  className={clsx('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', active.key === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}>{active.render(p)}</Suspense>
        </div>

        {/* Lateral: próxima sessão, sessões restantes, pacote, saldo, última sessão, status */}
        <aside className="space-y-4">
          <Card>
            <div className="divide-y divide-slate-100">
              <SideStat icon={<CalendarClock className="size-4" />} label="Próxima sessão">
                {p.nextAppointment ? <>{formatDayTime(p.nextAppointment.startsAt)}<span className="block text-xs font-normal text-slate-500">{p.nextAppointment.service}</span></> : <span className="text-slate-400">Nenhuma agendada</span>}
              </SideStat>
              <SideStat icon={<ClipboardList className="size-4" />} label="Sessões restantes">
                {p.activePackage ? `${p.activePackage.remaining} de ${p.activePackage.contracted}` : <span className="text-slate-400">Sem pacote ativo</span>}
              </SideStat>
              <SideStat icon={<Package className="size-4" />} label="Pacote atual">
                {p.activePackage ? <>{p.activePackage.name}<span className="block text-xs font-normal text-slate-500">{formatMoney(p.activePackage.totalPriceCents)}</span></> : '—'}
              </SideStat>
              {can('finance.read') && (
                <SideStat icon={<CircleDollarSign className="size-4" />} label="Saldo em aberto">
                  <span className={p.balanceDueCents > 0 ? 'text-amber-700' : 'text-emerald-700'}>{formatMoney(p.balanceDueCents)}</span>
                </SideStat>
              )}
              <SideStat icon={<CalendarCheck2 className="size-4" />} label="Última sessão">
                {p.lastSessionAt ? formatDate(p.lastSessionAt) : <span className="text-slate-400">Nenhuma</span>}
                <span className="block text-xs font-normal text-slate-500">{p.sessionsDone} sessões realizadas</span>
              </SideStat>
            </div>
          </Card>
          <Card className="p-4">
            <label htmlFor="stage" className="text-xs text-slate-500">Status do tratamento</label>
            <Select id="stage" className="mt-1.5" value={p.crmStage} disabled={!can('patients.write') || stage.isPending} onChange={(e) => stage.mutate(e.target.value)}>
              {PATIENT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </Select>
          </Card>
        </aside>
      </div>

      {editing && <PatientFormModal initial={p as never} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title={`Excluir ${p.name}?`}
        description="O paciente sai das listas e do CRM. Prontuário, sessões e pagamentos continuam guardados e auditados."
        confirmLabel="Excluir paciente"
      />
    </>
  );
}
