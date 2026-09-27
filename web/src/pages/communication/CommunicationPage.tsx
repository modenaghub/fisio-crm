import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
  ArrowLeft, BellRing, Bot, CheckCircle2, FlaskConical, Inbox, Link2, MessageCircle, RotateCcw, Search, Send, UserPlus, XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Switch, Tabs, Textarea } from '@/components/ui';
import { PatientPicker, type PickedPatient } from '@/components/PatientPicker';
import { Composer, CONVERSATION_STATUS, MessageThread, type ConversationDetail, type ConversationSummary, type MessageTemplateRow } from '@/components/messaging';

interface ListResponse {
  items: ConversationSummary[];
  total: number;
  counts: { BOT: number; OPEN: number; ASSIGNED: number; CLOSED: number; unread: number };
}
interface Status { mode: 'mock' | 'real'; phoneNumberId: string | null; webhookUrl: string; remindersEnabled: boolean }

type Filter = 'active' | 'unread' | 'mine' | 'BOT' | 'OPEN' | 'CLOSED';

// ───────────────────────── simulador ─────────────────────────

function SimulateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (conversationId: string) => void }) {
  const [from, setFrom] = useState('');
  const [text, setText] = useState('');
  const m = useMutation({
    mutationFn: () => api<{ conversationId: string }>('/communication/simulate', { method: 'POST', body: { from, text } }),
    onSuccess: (r) => { toast.success('Mensagem recebida (simulação)'); setText(''); onDone(r.conversationId); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Simular mensagem recebida" description="Como se o contato tivesse escrito no WhatsApp da clínica. Útil para testar o robô e as respostas aos lembretes."
      footer={<><Button variant="outline" onClick={onClose}>Fechar</Button><Button loading={m.isPending} disabled={!from || !text} icon={<Send className="size-4" />} onClick={() => m.mutate()}>Receber</Button></>}>
      <div className="space-y-4">
        <Field label="WhatsApp de quem escreve" hint="Um número novo passa pelo robô de cadastro; o de um paciente cai na conversa dele.">
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="(11) 98888-7777" inputMode="tel" />
        </Field>
        <Field label="Mensagem">
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Oi! Gostaria de agendar uma avaliação." />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {['CONFIRMAR', 'REAGENDAR', 'CANCELAR', 'SAIR'].map((k) => (
            <button key={k} type="button" onClick={() => setText(k)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">{k}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────── conversa aberta ─────────────────────────

function ConversationPanel({ id, onBack }: { id: string; onBack: () => void }) {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [linking, setLinking] = useState(false);
  const [picked, setPicked] = useState<PickedPatient | null>(null);
  const q = useQuery({ queryKey: ['conversation', id], queryFn: () => api<ConversationDetail>(`/conversations/${id}`), refetchInterval: 8_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['conversation', id] }); qc.invalidateQueries({ queryKey: ['conversations'] }); };
  useEffect(() => { if (q.data) qc.invalidateQueries({ queryKey: ['conversations'] }); }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useMutation({ mutationFn: (p: { body?: string; templateKey?: string }) => api(`/conversations/${id}/messages`, { method: 'POST', body: p }), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const assign = useMutation({ mutationFn: (userId: string | null) => api(`/conversations/${id}/assign`, { method: 'PATCH', body: { userId } }), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const status = useMutation({ mutationFn: (s: 'OPEN' | 'CLOSED') => api(`/conversations/${id}/status`, { method: 'PATCH', body: { status: s } }), onSuccess: (_, s) => { refresh(); toast.success(s === 'CLOSED' ? 'Conversa encerrada' : 'Conversa reaberta'); }, onError: (e) => toast.error(e.message) });
  const link = useMutation({
    mutationFn: () => api(`/conversations/${id}/link`, { method: 'PATCH', body: { patientId: picked?.id } }),
    onSuccess: () => { refresh(); setLinking(false); toast.success('Conversa vinculada ao paciente'); },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingState rows={5} />;
  if (q.isError || !q.data) return <ErrorState message={q.error?.message} onRetry={() => q.refetch()} />;
  const c = q.data;
  const name = c.contactName ?? c.phoneFormatted;
  const canSend = can('messages.send');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button onClick={onBack} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Voltar para a lista"><ArrowLeft className="size-5" /></button>
        <Avatar name={name} src={c.patient?.photoUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {c.patient ? <Link to={`/pacientes/${c.patient.id}`} className="hover:underline">{name}</Link> : name}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span className="tabular">{c.phoneFormatted}</span>
            {c.patient && <span>· Paciente</span>}
            {!c.patient && c.lead && <span>· <Link to="/crm" className="text-brand-700 hover:underline">Lead no CRM</Link></span>}
            {c.assignedTo && <span>· com {c.assignedTo.id === me?.user.id ? 'você' : c.assignedTo.name}</span>}
          </p>
        </div>
        <Badge tone={CONVERSATION_STATUS[c.status].tone}>{CONVERSATION_STATUS[c.status].label}</Badge>
        {canSend && (
          <div className="flex flex-wrap gap-2">
            {!c.patient && <Button size="sm" variant="outline" icon={<Link2 className="size-4" />} onClick={() => setLinking(true)}>Vincular paciente</Button>}
            {c.assignedTo?.id !== me?.user.id && c.status !== 'CLOSED' && <Button size="sm" variant="outline" icon={<UserPlus className="size-4" />} loading={assign.isPending} onClick={() => assign.mutate(me!.user.id)}>Assumir</Button>}
            {c.status === 'CLOSED'
              ? <Button size="sm" variant="outline" icon={<RotateCcw className="size-4" />} loading={status.isPending} onClick={() => status.mutate('OPEN')}>Reabrir</Button>
              : <Button size="sm" variant="outline" icon={<CheckCircle2 className="size-4" />} loading={status.isPending} onClick={() => status.mutate('CLOSED')}>Encerrar</Button>}
          </div>
        )}
      </div>
      {c.status === 'BOT' && (
        <p className="flex items-center gap-2 border-b border-violet-100 bg-violet-50 px-4 py-2 text-xs text-violet-800">
          <Bot className="size-4" /> O robô está coletando nome, motivo e melhor período. Se você responder, o robô para e a conversa passa para você.
        </p>
      )}
      <MessageThread messages={c.messages} className="min-h-0 flex-1" />
      <Composer windowOpen={c.windowOpen} windowEndsAt={c.serviceWindowEndsAt} sending={send.isPending} onSend={(p) => send.mutateAsync(p)} disabledReason={canSend ? null : 'Você pode ler, mas não enviar mensagens.'} />

      <Modal open={linking} onClose={() => setLinking(false)} size="sm" title="Vincular a um paciente" description="A conversa passa a aparecer na ficha do paciente."
        footer={<><Button variant="outline" onClick={() => setLinking(false)}>Cancelar</Button><Button disabled={!picked} loading={link.isPending} onClick={() => link.mutate()}>Vincular</Button></>}>
        <PatientPicker value={picked} onChange={setPicked} autoFocus />
      </Modal>
    </div>
  );
}

// ───────────────────────── caixa de entrada ─────────────────────────

function Inbox_() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('c');
  const [filter, setFilter] = useState<Filter>('active');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  const q = useQuery({
    queryKey: ['conversations', filter, search],
    queryFn: () => api<ListResponse>(`/conversations?status=${filter}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    refetchInterval: 10_000,
  });
  const select = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('c', id); else p.delete('c');
    setParams(p, { replace: !id });
  };
  const counts = q.data?.counts;
  const chips: { value: Filter; label: string; n?: number }[] = [
    { value: 'active', label: 'Ativas' },
    { value: 'unread', label: 'Não lidas', n: counts?.unread },
    { value: 'OPEN', label: 'Aguardando', n: counts?.OPEN },
    { value: 'mine', label: 'Minhas' },
    { value: 'BOT', label: 'No robô', n: counts?.BOT },
    { value: 'CLOSED', label: 'Encerradas' },
  ];

  return (
    <Card className="grid h-[calc(100vh-15rem)] min-h-[32rem] grid-cols-1 overflow-hidden lg:grid-cols-[22rem_1fr]">
      <div className={clsx('flex min-h-0 min-w-0 flex-col border-slate-200 lg:border-r', selected && 'hidden lg:flex')}>
        <div className="space-y-3 border-b border-slate-200 p-3">
          <Input leading={<Search className="size-4" />} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar nome ou telefone" aria-label="Buscar conversas" />
          <div className="flex flex-wrap gap-1.5">
            {chips.map((ch) => (
              <button key={ch.value} onClick={() => setFilter(ch.value)} aria-pressed={filter === ch.value}
                className={clsx('rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', filter === ch.value ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
                {ch.label}{ch.n ? ` · ${ch.n}` : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {q.isLoading && <LoadingState rows={5} />}
          {q.data && q.data.items.length === 0 && <EmptyState icon={<Inbox className="size-6" />} title="Nenhuma conversa aqui" description={filter === 'active' ? 'Quando alguém escrever no WhatsApp da clínica, a conversa aparece aqui.' : undefined} />}
          <ul className="divide-y divide-slate-100">
            {q.data?.items.map((c) => {
              const name = c.contactName ?? c.phoneFormatted;
              return (
                <li key={c.id}>
                  <button onClick={() => select(c.id)} className={clsx('flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-slate-50', selected === c.id && 'bg-brand-50/60')}>
                    <Avatar name={name} src={c.patient?.photoUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={clsx('truncate text-sm', c.unreadCount ? 'font-semibold text-slate-900' : 'font-medium text-slate-800')}>{name}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-slate-500">{c.lastMessageAt ? formatRelative(c.lastMessageAt) : ''}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={clsx('line-clamp-1 flex-1 text-xs', c.unreadCount ? 'text-slate-700' : 'text-slate-500')}>
                          {c.lastMessage ? `${c.lastMessage.direction === 'OUTBOUND' ? 'Você: ' : ''}${c.lastMessage.body}` : 'Sem mensagens'}
                        </span>
                        {c.unreadCount > 0 && <span className="rounded-full bg-brand-700 px-1.5 text-[11px] font-semibold text-white tabular" aria-label={`${c.unreadCount} não lidas`}>{c.unreadCount}</span>}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={CONVERSATION_STATUS[c.status].tone}>{CONVERSATION_STATUS[c.status].label}</Badge>
                        {!c.patient && c.lead && <Badge tone="blue">Lead</Badge>}
                        {!c.patient && !c.lead && <Badge>Novo contato</Badge>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className={clsx('min-h-0 min-w-0', !selected && 'hidden lg:block')}>
        {selected ? (
          <ConversationPanel key={selected} id={selected} onBack={() => select(null)} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<MessageCircle className="size-6" />} title="Selecione uma conversa" description="Responda pacientes, acompanhe o robô de cadastro e as respostas aos lembretes." />
          </div>
        )}
      </div>
    </Card>
  );
}

// ───────────────────────── modelos ─────────────────────────

const GROUPS: { key: MessageTemplateRow['group']; title: string; description: string }[] = [
  { key: 'lembretes', title: 'Lembretes de sessão', description: 'Enviados automaticamente 24 h e 2 h antes. Precisam de template aprovado na Meta, pois o paciente pode não ter escrito nas últimas 24 h.' },
  { key: 'relacionamento', title: 'Relacionamento', description: 'Falta, pós-sessão, sem retorno, pacote acabando e cobrança — usados pela equipe e pelas automações.' },
  { key: 'robo', title: 'Robô de primeiro contato', description: 'Conversa com quem escreve pela primeira vez e cria o lead no CRM.' },
  { key: 'respostas', title: 'Respostas automáticas', description: 'Enviadas quando o paciente responde CONFIRMAR, REAGENDAR, CANCELAR, SAIR ou VOLTAR.' },
];

const SAMPLE: Record<string, string> = { paciente: 'Joana', nome: 'Joana', clinica: 'Clínica Movimento', data: 'terça-feira, 14/10', hora: '14:00', profissional: 'Dra. Ana', servico: 'sessão', restantes: '2', valor: 'R$ 120,00', vencimento: '10/10' };
const fill = (body: string) => body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => SAMPLE[k] ?? `{{${k}}}`);

function TemplateEditor({ t, onClose }: { t: MessageTemplateRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState(t.body);
  const [waName, setWaName] = useState(t.whatsappTemplateName ?? '');
  const save = useMutation({
    mutationFn: () => api(`/communication/templates/${t.id}`, { method: 'PUT', body: { body, whatsappTemplateName: waName || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['message-templates'] }); toast.success('Modelo salvo'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} size="lg" title={t.name}
      footer={<>{t.defaultBody && t.defaultBody !== body && <Button variant="ghost" className="mr-auto" onClick={() => setBody(t.defaultBody!)}>Restaurar texto padrão</Button>}<Button variant="outline" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Texto" hint={t.variables.length ? <>Variáveis: {t.variables.map((v) => <code key={v} className="mr-1 rounded bg-slate-100 px-1 text-[11px]">{`{{${v}}}`}</code>)}</> : undefined}>
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {(t.group === 'lembretes' || t.group === 'relacionamento') && (
            <Field label="Nome do template aprovado na Meta" hint="Necessário para enviar fora da janela de 24 h. O texto aprovado na Meta deve ter as mesmas variáveis, na mesma ordem.">
              <Input value={waName} onChange={(e) => setWaName(e.target.value)} placeholder="lembrete_sessao_24h" />
            </Field>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Prévia</p>
          <div className="rounded-xl bg-slate-100 p-4">
            <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-brand-50 px-3.5 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-brand-100">
              <p className="whitespace-pre-wrap">{fill(body)}</p>
            </div>
            {t.buttons.length > 0 && (
              <div className="ml-auto mt-1.5 flex max-w-[90%] flex-wrap justify-end gap-1.5">
                {t.buttons.map((b) => <span key={b} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-sky-700 shadow-sm ring-1 ring-slate-200">{b}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Templates() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MessageTemplateRow | null>(null);
  const q = useQuery({ queryKey: ['message-templates'], queryFn: () => api<MessageTemplateRow[]>('/communication/templates') });
  const toggle = useMutation({
    mutationFn: (t: MessageTemplateRow) => api(`/communication/templates/${t.id}`, { method: 'PUT', body: { isActive: !t.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-templates'] }),
    onError: (e) => toast.error(e.message),
  });
  const manage = can('automations.manage');
  if (q.isLoading) return <Card><LoadingState rows={6} /></Card>;
  if (q.isError) return <Card><ErrorState message={q.error?.message} onRetry={() => q.refetch()} /></Card>;
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => (
        <Card key={g.key}>
          <CardHeader title={g.title} description={g.description} />
          <ul className="divide-y divide-slate-100">
            {q.data?.filter((t) => t.group === g.key).map((t) => (
              <li key={t.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    {t.name}
                    {!t.isActive && <Badge>Desativado</Badge>}
                    {t.whatsappTemplateName && <Badge tone="green">Template: {t.whatsappTemplateName}</Badge>}
                  </p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{t.body}</p>
                  {t.buttons.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1">{t.buttons.map((b) => <span key={b} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{b}</span>)}</p>}
                </div>
                {manage && (
                  <div className="flex items-center gap-3">
                    {(g.key === 'lembretes' || g.key === 'relacionamento') && <Switch checked={t.isActive} onChange={() => toggle.mutate(t)} label={t.isActive ? 'Ativo' : 'Inativo'} />}
                    <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Editar</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {editing && <TemplateEditor t={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ───────────────────────── lembretes ─────────────────────────

function Reminders({ status }: { status?: Status }) {
  const { can } = useAuth();
  const [last, setLast] = useState<{ sent: number; skipped: { reason: string }[] } | null>(null);
  const run = useMutation({
    mutationFn: () => api<{ sent: number; skipped: { reason: string }[] }>('/communication/reminders/run', { method: 'POST', body: { includeRecent: true } }),
    onSuccess: (r) => { setLast(r); toast.success(r.sent ? `${r.sent} lembrete(s) enviado(s)` : 'Nenhum lembrete pendente agora'); },
    onError: (e) => toast.error(e.message),
  });
  const REASONS: Record<string, string> = { opt_out: 'paciente pediu para não receber', no_phone: 'sem WhatsApp cadastrado', inactive: 'modelo desativado', error: 'erro no envio' };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Como funcionam" />
        <ul className="space-y-3 px-5 pb-5 text-sm text-slate-700">
          <li className="flex gap-3"><BellRing className="mt-0.5 size-4 shrink-0 text-brand-700" /><span><strong>24 h antes</strong> o paciente recebe o lembrete com os botões CONFIRMAR, REAGENDAR e CANCELAR.</span></li>
          <li className="flex gap-3"><BellRing className="mt-0.5 size-4 shrink-0 text-brand-700" /><span><strong>2 h antes</strong> vai um lembrete curto.</span></li>
          <li className="flex gap-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /><span><strong>CONFIRMAR</strong> confirma o horário na agenda na hora.</span></li>
          <li className="flex gap-3"><XCircle className="mt-0.5 size-4 shrink-0 text-red-600" /><span><strong>CANCELAR</strong> libera o horário e avisa o fisioterapeuta e a recepção.</span></li>
          <li className="flex gap-3"><RotateCcw className="mt-0.5 size-4 shrink-0 text-amber-600" /><span><strong>REAGENDAR</strong> cria uma tarefa para a recepção combinar o novo horário.</span></li>
          <li className="flex gap-3"><MessageCircle className="mt-0.5 size-4 shrink-0 text-slate-500" /><span>Quem responder <strong>SAIR</strong> deixa de receber mensagens automáticas (LGPD); <strong>VOLTAR</strong> reativa.</span></li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Envio" description={status?.remindersEnabled ? 'Automático, verificado a cada minuto.' : 'Envio automático desligado neste servidor (REMINDERS_ENABLED=0).'} />
        <div className="space-y-4 px-5 pb-5">
          <p className="text-sm text-slate-600">Para ativar ou desativar cada lembrete, ou mudar o texto, use a aba Modelos.</p>
          {can('automations.manage') && <Button icon={<Send className="size-4" />} loading={run.isPending} onClick={() => run.mutate()}>Enviar lembretes pendentes agora</Button>}
          {last && (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p><strong>{last.sent}</strong> enviado(s).</p>
              {last.skipped.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-slate-600">
                  {Object.entries(last.skipped.reduce<Record<string, number>>((a, s) => ({ ...a, [s.reason]: (a[s.reason] ?? 0) + 1 }), {})).map(([r, n]) => <li key={r}>{n} não enviado(s): {REASONS[r] ?? r}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ───────────────────────── página ─────────────────────────

export function CommunicationPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as 'conversas' | 'modelos' | 'lembretes') ?? 'conversas';
  const setTab = (t: string) => { const p = new URLSearchParams(params); p.set('aba', t); p.delete('c'); setParams(p); };
  const [simulating, setSimulating] = useState(false);
  const status = useQuery({ queryKey: ['communication-status'], queryFn: () => api<Status>('/communication/status'), staleTime: 300_000 });
  const openConversation = (id: string) => { setSimulating(false); const p = new URLSearchParams(); p.set('c', id); setParams(p); };

  return (
    <>
      <PageHeader
        title="Comunicação"
        description="WhatsApp da clínica: conversas, robô de primeiro contato, lembretes e modelos de mensagem."
        actions={status.data?.mode === 'mock' && can('messages.send') ? <Button variant="outline" icon={<FlaskConical className="size-4" />} onClick={() => setSimulating(true)}>Simular mensagem recebida</Button> : undefined}
      />
      {status.data?.mode === 'mock' && (
        <div className="mb-5">
          <Alert tone="blue" title="Modo demonstração">
            Nenhuma mensagem sai para o WhatsApp de verdade — tudo fica registrado aqui. Para produção, conecte a API oficial do WhatsApp (Cloud API da Meta) nas variáveis do servidor.
          </Alert>
        </div>
      )}
      <div className="mb-5">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'conversas', label: 'Conversas' }, { value: 'modelos', label: 'Modelos' }, { value: 'lembretes', label: 'Lembretes' }]} />
      </div>
      {tab === 'conversas' && <Inbox_ />}
      {tab === 'modelos' && <Templates />}
      {tab === 'lembretes' && <Reminders status={status.data} />}
      <SimulateModal open={simulating} onClose={() => setSimulating(false)} onDone={openConversation} />
    </>
  );
}
