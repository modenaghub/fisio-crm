import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, SendHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { Button } from '@/components/ui';

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';
  isAutomated: boolean;
  isMock: boolean;
  errorMessage: string | null;
  createdAt: string;
  sentBy: { id: string; name: string } | null;
  template: { key: string; name: string } | null;
}

export interface ConversationSummary {
  id: string;
  status: 'BOT' | 'OPEN' | 'ASSIGNED' | 'CLOSED';
  phone: string;
  phoneFormatted: string;
  contactName: string | null;
  patient: { id: string; name: string; photoUrl: string | null } | null;
  lead: { id: string; name: string; stage: string } | null;
  assignedTo: { id: string; name: string } | null;
  unreadCount: number;
  lastMessageAt: string | null;
  windowOpen: boolean;
  serviceWindowEndsAt: string | null;
  lastMessage: { body: string; direction: 'INBOUND' | 'OUTBOUND'; createdAt: string } | null;
  botStep: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

export interface MessageTemplateRow {
  id: string;
  key: string;
  name: string;
  body: string;
  buttons: string[];
  whatsappTemplateName: string | null;
  isActive: boolean;
  group: 'lembretes' | 'respostas' | 'robo' | 'relacionamento';
  variables: string[];
  defaultBody: string | null;
}

export const CONVERSATION_STATUS: Record<ConversationSummary['status'], { label: string; tone: 'violet' | 'amber' | 'brand' | 'slate' }> = {
  BOT: { label: 'No robô', tone: 'violet' },
  OPEN: { label: 'Aguardando', tone: 'amber' },
  ASSIGNED: { label: 'Em atendimento', tone: 'brand' },
  CLOSED: { label: 'Encerrada', tone: 'slate' },
};

function StatusTicks({ m }: { m: ChatMessage }) {
  if (m.direction === 'INBOUND') return null;
  if (m.status === 'FAILED') return <AlertCircle className="size-3.5 text-red-600" aria-label="Falhou" />;
  if (m.status === 'READ') return <CheckCheck className="size-3.5 text-sky-600" aria-label="Lida" />;
  if (m.status === 'DELIVERED') return <CheckCheck className="size-3.5 text-slate-400" aria-label="Entregue" />;
  if (m.status === 'QUEUED') return <Clock className="size-3.5 text-slate-400" aria-label="Na fila" />;
  return <Check className="size-3.5 text-slate-400" aria-label="Enviada" />;
}

/** Conversa em balões, agrupada por dia; rola para a última mensagem. */
export function MessageThread({ messages, className }: { messages: ChatMessage[]; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const last = messages.at(-1)?.id;
  // Rola só o contêiner da conversa (scrollIntoView rolaria a página inteira no celular).
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [last]);
  let prevDay = '';
  return (
    <div ref={box} className={clsx('space-y-1.5 overflow-y-auto bg-slate-50 px-4 py-4', className)}>
      {messages.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Nenhuma mensagem ainda.</p>}
      {messages.map((m) => {
        const day = formatDate(m.createdAt, { dateStyle: 'long' });
        const showDay = day !== prevDay;
        prevDay = day;
        const out = m.direction === 'OUTBOUND';
        return (
          <Fragment key={m.id}>
            {showDay && <p className="py-2 text-center text-xs font-medium text-slate-500">{day}</p>}
            <div className={clsx('flex', out ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm', out ? 'rounded-br-md bg-brand-50 text-slate-900 ring-1 ring-brand-100' : 'rounded-bl-md bg-white text-slate-900 ring-1 ring-slate-200', m.status === 'FAILED' && 'ring-red-300')}>
                {(m.isAutomated || m.template) && out && (
                  <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                    {m.isAutomated ? <Bot className="size-3" /> : <FileText className="size-3" />}
                    {m.isAutomated ? 'Automático' : 'Modelo'}{m.template ? ` · ${m.template.name}` : ''}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-slate-500">
                  {out && m.sentBy && <span className="mr-1 truncate">{m.sentBy.name.split(' ')[0]}</span>}
                  {formatTime(m.createdAt)}
                  <StatusTicks m={m} />
                </p>
                {m.status === 'FAILED' && m.errorMessage && <p className="mt-1 text-xs text-red-700">{m.errorMessage}</p>}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function windowLeft(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600e3);
  return h >= 1 ? `${h} h` : `${Math.max(1, Math.round(ms / 60e3))} min`;
}

/**
 * Campo de envio. Dentro da janela de 24 h: texto livre ou modelo.
 * Fora dela: só modelos aprovados na Meta (regra do WhatsApp oficial).
 */
export function Composer({
  windowOpen, windowEndsAt, onSend, sending, disabledReason,
}: {
  windowOpen: boolean;
  windowEndsAt: string | null;
  onSend: (p: { body?: string; templateKey?: string }) => Promise<unknown>;
  sending: boolean;
  disabledReason?: string | null;
}) {
  const [text, setText] = useState('');
  const [picking, setPicking] = useState(false);
  const templates = useQuery({ queryKey: ['message-templates'], queryFn: () => api<MessageTemplateRow[]>('/communication/templates'), staleTime: 60_000 });
  const usable = useMemo(
    // Só modelos que o sistema consegue preencher sozinho (nome do paciente e da clínica).
    () => (templates.data ?? []).filter((t) => t.isActive && t.group === 'relacionamento' && t.variables.every((v) => ['paciente', 'clinica', 'nome'].includes(v)) && (windowOpen || !!t.whatsappTemplateName)),
    [templates.data, windowOpen],
  );
  const send = async (p: { body?: string; templateKey?: string }) => {
    try {
      await onSend(p);
      if (p.body) setText('');
      setPicking(false);
    } catch { /* o chamador mostra o erro */ }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (text.trim() && windowOpen) void send({ body: text.trim() });
    }
  };
  if (disabledReason) return <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">{disabledReason}</p>;
  const left = windowLeft(windowEndsAt);
  return (
    <div className="border-t border-slate-200 bg-white">
      {picking && (
        <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto border-b border-slate-200">
          {usable.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Nenhum modelo disponível.</li>}
          {usable.map((t) => (
            <li key={t.id}>
              <button type="button" disabled={sending} onClick={() => void send({ templateKey: t.key })} className="block w-full px-4 py-2.5 text-left hover:bg-slate-50">
                <span className="text-sm font-medium text-slate-900">{t.name}</span>
                <span className="mt-0.5 line-clamp-1 block text-xs text-slate-500">{t.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {windowOpen ? (
        <div className="flex items-end gap-2 p-3">
          <Button variant="outline" size="sm" icon={<FileText className="size-4" />} onClick={() => setPicking((v) => !v)} aria-expanded={picking}>Modelos</Button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={Math.min(5, Math.max(1, text.split('\n').length))}
            placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)"
            aria-label="Mensagem"
            className="min-h-9 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          <Button size="sm" icon={<SendHorizontal className="size-4" />} loading={sending} disabled={!text.trim()} onClick={() => void send({ body: text.trim() })}>Enviar</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 p-3">
          <p className="flex-1 text-xs text-slate-600">
            <Clock className="mr-1 inline size-3.5 -translate-y-px text-amber-600" />
            Fora da janela de 24 h do WhatsApp: só modelos aprovados podem ser enviados até o paciente responder.
          </p>
          <Button size="sm" variant="outline" icon={<FileText className="size-4" />} onClick={() => setPicking((v) => !v)} aria-expanded={picking}>Enviar modelo</Button>
        </div>
      )}
      {windowOpen && left && <p className="px-3 pb-2 text-[11px] text-slate-500">Janela de conversa aberta por mais {left}.</p>}
    </div>
  );
}
