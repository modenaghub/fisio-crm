import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CalendarClock, Clock, MessageCircle, Phone, Plus, Search, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDayTime, formatMoney, formatRelative, whatsappLink } from '@/lib/format';
import { LEAD_SOURCES, STAGE_COLORS, STAGE_LABELS, TEMPERATURE_LABELS } from '@/lib/labels';
import { Avatar, Button, ConfirmDialog, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '@/components/ui';
import { ConvertLeadModal, LeadFormModal, PatientFormModal, useProfessionals } from '@/components/crm-forms';

interface Card {
  kind: 'lead' | 'patient';
  id: string;
  code?: string;
  name: string;
  photoUrl: string | null;
  phone: string | null;
  birthDate: string | null;
  cpf: string | null;
  source: string;
  stage: string;
  temperature?: string | null;
  lastContactAt: string | null;
  nextAppointment: string | null;
  treatment: string | null;
  sessionsDone: number;
  sessionsRemaining: number | null;
  valueCents: number | null;
  responsible: { id: string; name: string } | null;
}
interface Column { key: string; label: string; kind: 'lead' | 'patient'; cards: Card[] }
interface Board { columns: Column[] }

function ageOf(birth: string | null) {
  if (!birth) return null;
  const [y, m, d] = birth.split('-').map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}

function KanbanCard({ card, onOpen, onDragStart }: { card: Card; onOpen: () => void; onDragStart: (e: React.DragEvent) => void }) {
  const age = ageOf(card.birthDate);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      role="button"
      tabIndex={0}
      className="group cursor-pointer rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm shadow-slate-900/[0.03] transition hover:border-brand-300 hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start gap-2.5">
        <Avatar name={card.name} src={card.photoUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{card.name}</p>
          <p className="truncate text-xs text-slate-500">
            {[card.code, age !== null ? `${age} anos` : null, card.cpf].filter(Boolean).join(' · ') || LEAD_SOURCES[card.source]}
          </p>
        </div>
        {card.temperature && (
          <span
            title={TEMPERATURE_LABELS[card.temperature]}
            className={clsx('mt-1 size-2 shrink-0 rounded-full', card.temperature === 'HOT' ? 'bg-red-500' : card.temperature === 'WARM' ? 'bg-amber-400' : 'bg-sky-400')}
          />
        )}
      </div>
      {card.treatment && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{card.treatment}</p>}
      <div className="mt-2.5 space-y-1 text-xs text-slate-500">
        {card.phone && (
          <p className="flex items-center gap-1.5">
            <Phone className="size-3" /> {card.phone}
          </p>
        )}
        {card.nextAppointment ? (
          <p className="flex items-center gap-1.5 font-medium text-brand-700">
            <CalendarClock className="size-3" /> {formatDayTime(card.nextAppointment)}
          </p>
        ) : (
          <p className="flex items-center gap-1.5">
            <Clock className="size-3" /> Último contato {formatRelative(card.lastContactAt)}
          </p>
        )}
      </div>
      {(card.kind === 'patient' || card.responsible) && (
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
          <span className="truncate">{card.responsible?.name.split(' ').slice(0, 2).join(' ') ?? 'Sem responsável'}</span>
          {card.kind === 'patient' && (
            <span className="shrink-0 tabular">
              {card.sessionsDone} sess.{card.sessionsRemaining !== null && ` · ${card.sessionsRemaining} rest.`}
              {card.valueCents ? ` · ${formatMoney(card.valueCents)}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function LeadDetailModal({ lead, onClose, onEdit, onConvert }: { lead: Card; onClose: () => void; onEdit: (full: Record<string, unknown>) => void; onConvert: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lead', lead.id], queryFn: () => api<Record<string, any>>(`/leads/${lead.id}`) });
  const [lost, setLost] = useState(false);
  const [reason, setReason] = useState('');
  const [remove, setRemove] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['crm-board'] });
    onClose();
  };
  const markLost = useMutation({ mutationFn: () => api(`/leads/${lead.id}/lost`, { method: 'POST', body: { reason } }), onSuccess: () => { toast.success('Lead marcado como perdido'); refresh(); }, onError: (e) => toast.error(e.message) });
  const del = useMutation({ mutationFn: () => api(`/leads/${lead.id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Lead excluído'); refresh(); }, onError: (e) => toast.error(e.message) });
  const stage = useMutation({
    mutationFn: (s: string) => api(`/leads/${lead.id}/stage`, { method: 'PATCH', body: { stage: s } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-board'] }); qc.invalidateQueries({ queryKey: ['lead', lead.id] }); toast.success('Etapa atualizada'); },
    onError: (e) => toast.error(e.message),
  });
  const l = q.data;
  const wa = whatsappLink(lead.phone);
  const yn = (b: unknown) => (b === true ? 'Sim' : b === false ? 'Não' : 'Não informado');
  const intake = (l?.intakeAnswers ?? null) as Record<string, string> | null;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={lead.name}
      description={`${STAGE_LABELS[lead.stage]} · primeiro contato ${l ? formatRelative(l.firstContactAt) : ''}`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setRemove(true)}>Excluir</Button>
          <Button variant="outline" onClick={() => setLost(true)}>Marcar como perdido</Button>
          <Button variant="outline" onClick={() => l && onEdit(l)}>Editar</Button>
          <Button icon={<UserPlus className="size-4" />} onClick={onConvert}>Converter em paciente</Button>
        </>
      }
    >
      {!l ? (
        <div className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /></div>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Field label="Etapa" className="w-60">
              <Select value={l.stage} onChange={(e) => stage.mutate(e.target.value)}>
                {['NEW_CONTACT', 'FIRST_SERVICE', 'DATA_COLLECTED', 'EVALUATION_SCHEDULED', 'EVALUATION_DONE'].map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </Select>
            </Field>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                <MessageCircle className="size-4" /> Abrir no WhatsApp
              </a>
            )}
          </div>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ['Telefone', l.phone], ['E-mail', l.email], ['CPF', l.cpf], ['Nascimento', l.birthDate ? `${formatDate(l.birthDate)} (${l.age} anos)` : null],
              ['Origem', `${LEAD_SOURCES[l.source]}${l.sourceDetail ? ` — ${l.sourceDetail}` : ''}`], ['Classificação', l.temperature ? TEMPERATURE_LABELS[l.temperature] : null],
              ['Motivo do contato', l.reason], ['Região com dor/lesão', l.bodyRegion], ['Possui diagnóstico', yn(l.hasDiagnosis)], ['Já fez fisioterapia', yn(l.previousPhysio)],
              ['Responsável', l.responsible?.name],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="text-slate-800">{(v as string) || '—'}</dd>
              </div>
            ))}
          </dl>
          {intake && Object.keys(intake).length > 0 && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Respostas do atendimento automático</p>
              <dl className="space-y-1">
                {Object.entries(intake).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-slate-500">{k}:</dt><dd className="text-slate-800">{String(v)}</dd></div>)}
              </dl>
            </div>
          )}
        </div>
      )}
      <Modal open={lost} onClose={() => setLost(false)} size="sm" title="Marcar como perdido" footer={<><Button variant="outline" onClick={() => setLost(false)}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 2} loading={markLost.isPending} onClick={() => markLost.mutate()}>Confirmar</Button></>}>
        <Field label="Motivo" hint="Ajuda a entender por que os contatos não viram pacientes.">
          <Textarea autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: achou o valor alto, sem horário disponível…" />
        </Field>
      </Modal>
      <ConfirmDialog open={remove} onClose={() => setRemove(false)} onConfirm={() => del.mutate()} loading={del.isPending} title={`Excluir ${lead.name}?`} description="O registro sai do funil. O histórico de auditoria é mantido." confirmLabel="Excluir" />
    </Modal>
  );
}

export function CrmPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [newLead, setNewLead] = useState(false);
  const [editLead, setEditLead] = useState<Record<string, unknown> | null>(null);
  const [newPatient, setNewPatient] = useState(false);
  const [openLead, setOpenLead] = useState<Card | null>(null);
  const [converting, setConverting] = useState<Card | null>(null);
  const pros = useProfessionals();

  const params = new URLSearchParams();
  if (search.trim().length >= 2) params.set('search', search.trim());
  if (responsibleId) params.set('responsibleId', responsibleId);
  const key = ['crm-board', params.toString()];
  const q = useQuery({ queryKey: key, queryFn: () => api<Board>(`/crm/board?${params}`), placeholderData: (p) => p });

  const move = useMutation({
    mutationFn: ({ card, to }: { card: Card; to: string }) =>
      api(card.kind === 'lead' ? `/leads/${card.id}/stage` : `/patients/${card.id}/stage`, { method: 'PATCH', body: { stage: to } }),
    onMutate: async ({ card, to }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Board>(key);
      qc.setQueryData<Board>(key, (b) =>
        b && {
          columns: b.columns.map((c) => ({
            ...c,
            cards: c.key === to ? [{ ...card, stage: to }, ...c.cards] : c.cards.filter((x) => x.id !== card.id),
          })),
        },
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['crm-board'] }),
  });

  const onDrop = (col: Column, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const card = JSON.parse(raw) as Card;
    if (card.stage === col.key) return;
    if (card.kind === 'lead' && col.kind === 'patient') {
      if (!can('patients.write')) return toast.error('Você não tem permissão para cadastrar pacientes');
      return setConverting(card);
    }
    if (card.kind === 'patient' && col.kind === 'lead') return toast.error('Pacientes não voltam para as etapas de lead. Use "Reativação".');
    move.mutate({ card, to: col.key });
  };

  const totals = useMemo(() => {
    const cols = q.data?.columns ?? [];
    const leads = cols.filter((c) => c.kind === 'lead').reduce((n, c) => n + c.cards.length, 0);
    const patients = cols.filter((c) => c.kind === 'patient' && ['TREATMENT_STARTED', 'ACTIVE', 'IN_TREATMENT'].includes(c.key)).reduce((n, c) => n + c.cards.length, 0);
    return { leads, patients };
  }, [q.data]);

  return (
    <>
      <PageHeader
        title="CRM"
        description={q.data ? `${totals.leads} leads em aberto · ${totals.patients} pacientes em tratamento` : 'Funil de contatos e pacientes'}
        actions={
          <>
            {can('patients.write') && <Button variant="outline" icon={<UserPlus className="size-4" />} onClick={() => setNewPatient(true)}>Novo paciente</Button>}
            {can('leads.write') && <Button icon={<Plus className="size-4" />} onClick={() => setNewLead(true)}>Novo contato</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-72">
          <Input leading={<Search className="size-4" />} placeholder="Buscar nome, telefone, CPF…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="sm:w-60">
          <Select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} aria-label="Responsável">
            <option value="">Todos os responsáveis</option>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
      </div>

      {q.isError && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex snap-x gap-3">
          {(q.data?.columns ?? Array.from({ length: 6 }, (_, i) => ({ key: String(i), label: '', kind: 'lead' as const, cards: [] }))).map((col) => (
            <section
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver((k) => (k === col.key ? null : k))}
              onDrop={(e) => onDrop(col, e)}
              className={clsx('flex w-[272px] shrink-0 snap-start flex-col rounded-xl bg-slate-100/80 transition-colors', dragOver === col.key && 'bg-brand-50 ring-2 ring-brand-300')}
              aria-label={col.label}
            >
              <header className="sticky top-0 rounded-t-xl px-3 pb-2 pt-3">
                <div className="mb-2 h-1 rounded-full" style={{ background: STAGE_COLORS[col.key] ?? '#cbd5e1' }} />
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">{col.label || <Skeleton className="h-4 w-24" />}</h2>
                  {col.label && <span className="rounded-full bg-white px-2 text-xs font-medium text-slate-500 tabular">{col.cards.length}</span>}
                </div>
                {col.label && <p className="text-[11px] text-slate-400">{col.kind === 'lead' ? 'Lead' : 'Paciente'}</p>}
              </header>
              <div className="flex max-h-[calc(100dvh-280px)] min-h-32 flex-col gap-2 overflow-y-auto px-2 pb-3">
                {q.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
                {col.cards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(card))}
                    onOpen={() => (card.kind === 'lead' ? setOpenLead(card) : navigate(`/pacientes/${card.id}`))}
                  />
                ))}
                {!q.isLoading && col.cards.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">Arraste um card para cá</p>}
              </div>
            </section>
          ))}
        </div>
      </div>

      {newLead && <LeadFormModal onClose={() => setNewLead(false)} />}
      {editLead && <LeadFormModal initial={editLead as never} onClose={() => setEditLead(null)} />}
      {newPatient && <PatientFormModal onClose={() => setNewPatient(false)} onSaved={(id) => navigate(`/pacientes/${id}`)} />}
      {openLead && (
        <LeadDetailModal
          lead={openLead}
          onClose={() => setOpenLead(null)}
          onEdit={(full) => { setOpenLead(null); setEditLead(full); }}
          onConvert={() => { setConverting(openLead); setOpenLead(null); }}
        />
      )}
      {converting && <ConvertLeadModal lead={converting} onClose={() => setConverting(null)} onDone={(id) => { setConverting(null); navigate(`/pacientes/${id}`); }} />}
    </>
  );
}

