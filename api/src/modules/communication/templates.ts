import { digits, localDateKey, localTime } from '../../common/helpers';

/**
 * Telefone canônico para o WhatsApp (formato wa_id: DDI + DDD + número, só dígitos).
 * Celulares brasileiros antigos sem o nono dígito recebem o 9 — assim a conversa é a mesma
 * quer a Meta envie o número com ou sem ele.
 */
export function canonicalPhone(raw?: string | null): string | null {
  let d = digits(raw);
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith('55') && d.length === 12 && /[6-9]/.test(d[4])) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

/** Formas locais (sem DDI) de um número, para encontrar paciente/lead pelo telefone cadastrado. */
export function localVariants(canonical: string) {
  const local = canonical.startsWith('55') ? canonical.slice(2) : canonical;
  const out = new Set([local]);
  if (local.length === 11 && local[2] === '9') out.add(local.slice(0, 2) + local.slice(3));
  return [...out];
}

export function formatPhone(canonical: string) {
  const l = canonical.startsWith('55') ? canonical.slice(2) : canonical;
  if (l.length === 11) return `(${l.slice(0, 2)}) ${l.slice(2, 7)}-${l.slice(7)}`;
  if (l.length === 10) return `(${l.slice(0, 2)}) ${l.slice(2, 6)}-${l.slice(6)}`;
  return `+${canonical}`;
}

export function render(body: string, vars: Record<string, string | number | null | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])));
}

export const WEEKDAY_NAMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function appointmentVars(a: { startsAt: Date; professional?: { name: string } | null; service?: { name: string } | null }) {
  const key = localDateKey(a.startsAt);
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay();
  return {
    data: `${WEEKDAY_NAMES[wd]}, ${key.slice(8, 10)}/${key.slice(5, 7)}`,
    hora: localTime(a.startsAt),
    profissional: a.professional?.name ?? '',
    servico: a.service?.name ?? 'sessão',
  };
}

export const firstName = (name?: string | null) => (name ?? '').trim().split(/\s+/)[0] ?? '';

export interface DefaultTemplate {
  key: string;
  name: string;
  body: string;
  buttons?: string[];
  /** Nome do template aprovado na Meta — permite enviar fora da janela de 24 h. */
  whatsappTemplateName?: string;
  group: 'lembretes' | 'respostas' | 'robo' | 'relacionamento';
  variables: string[];
}

/** Textos padrão criados para cada clínica (editáveis em Comunicação → Modelos). */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: 'reminder_24h', group: 'lembretes', name: 'Lembrete 24 h antes', whatsappTemplateName: 'lembrete_sessao_24h',
    body: 'Olá, {{paciente}}! Lembrete da sua {{servico}} na {{clinica}}: {{data}}, às {{hora}}, com {{profissional}}. Responda CONFIRMAR, REAGENDAR ou CANCELAR.',
    buttons: ['CONFIRMAR', 'REAGENDAR', 'CANCELAR'], variables: ['paciente', 'clinica', 'data', 'hora', 'profissional', 'servico'],
  },
  {
    key: 'reminder_2h', group: 'lembretes', name: 'Lembrete 2 h antes', whatsappTemplateName: 'lembrete_sessao_2h',
    body: '{{paciente}}, sua {{servico}} na {{clinica}} começa às {{hora}}. Até já! Se não puder vir, responda CANCELAR.',
    buttons: ['CONFIRMAR', 'CANCELAR'], variables: ['paciente', 'clinica', 'hora', 'servico'],
  },
  { key: 'reply_confirmed', group: 'respostas', name: 'Resposta: presença confirmada', body: 'Presença confirmada! Te esperamos {{data}}, às {{hora}}. 😊', variables: ['data', 'hora'] },
  { key: 'reply_cancelled', group: 'respostas', name: 'Resposta: sessão cancelada', body: 'Sua sessão de {{data}}, às {{hora}}, foi cancelada. Quando quiser remarcar, é só responder aqui.', variables: ['data', 'hora'] },
  { key: 'reply_reschedule', group: 'respostas', name: 'Resposta: pedido de remarcação', body: 'Certo! Nossa equipe vai falar com você em instantes para escolher um novo horário.', variables: [] },
  { key: 'reply_no_appointment', group: 'respostas', name: 'Resposta: sem sessão agendada', body: 'Não encontramos uma sessão agendada para os próximos dias. Nossa equipe vai te responder em breve.', variables: [] },
  { key: 'reply_opt_out', group: 'respostas', name: 'Resposta: descadastro', body: 'Pronto, você não receberá mais mensagens automáticas da {{clinica}}. Se mudar de ideia, responda VOLTAR.', variables: ['clinica'] },
  { key: 'reply_opt_in', group: 'respostas', name: 'Resposta: recadastro', body: 'Combinado! Você voltará a receber lembretes da {{clinica}}.', variables: ['clinica'] },
  {
    key: 'bot_welcome', group: 'robo', name: 'Robô: boas-vindas',
    body: 'Olá! Você falou com a {{clinica}}. 👋 Para agilizar seu atendimento, qual é o seu nome completo?\n\nSeus dados serão usados apenas para o seu atendimento, conforme a LGPD.',
    variables: ['clinica'],
  },
  { key: 'bot_ask_reason', group: 'robo', name: 'Robô: motivo do contato', body: 'Obrigado, {{nome}}! Conte em poucas palavras o motivo do contato (por exemplo: dor lombar, pós-operatório de joelho).', variables: ['nome'] },
  { key: 'bot_ask_period', group: 'robo', name: 'Robô: melhor período', body: 'Qual o melhor período para você? Responda 1 para manhã, 2 para tarde ou 3 para noite.', buttons: ['1 - Manhã', '2 - Tarde', '3 - Noite'], variables: [] },
  { key: 'bot_done', group: 'robo', name: 'Robô: cadastro concluído', body: 'Pronto, {{nome}}! Recebemos seus dados e nossa equipe vai te chamar em instantes para agendar sua avaliação.', variables: ['nome'] },
  {
    key: 'no_show', group: 'relacionamento', name: 'Falta na sessão', whatsappTemplateName: 'falta_sessao',
    body: 'Olá, {{paciente}}. Sentimos sua falta na sessão de hoje. Quer remarcar? Responda REAGENDAR que a gente te ajuda.', variables: ['paciente'],
  },
  {
    key: 'post_session', group: 'relacionamento', name: 'Pós-sessão', whatsappTemplateName: 'pos_sessao',
    body: 'Olá, {{paciente}}! Como você está se sentindo depois da sessão de hoje? Qualquer desconforto, é só avisar.', variables: ['paciente'],
  },
  {
    key: 'no_return', group: 'relacionamento', name: 'Paciente sem retorno', whatsappTemplateName: 'sem_retorno',
    body: 'Olá, {{paciente}}! Faz um tempinho desde a sua última sessão na {{clinica}}. Vamos agendar a próxima?', variables: ['paciente', 'clinica'],
  },
  {
    key: 'package_ending', group: 'relacionamento', name: 'Pacote acabando', whatsappTemplateName: 'pacote_acabando',
    body: '{{paciente}}, restam {{restantes}} sessão(ões) no seu pacote. Quer que a gente já deixe a renovação preparada?', variables: ['paciente', 'restantes'],
  },
  {
    key: 'payment_overdue', group: 'relacionamento', name: 'Pagamento em aberto', whatsappTemplateName: 'pagamento_pendente',
    body: 'Olá, {{paciente}}. Consta um valor em aberto de {{valor}}, com vencimento em {{vencimento}}. Qualquer dúvida, estamos à disposição.', variables: ['paciente', 'valor', 'vencimento'],
  },
];

export const TEMPLATE_META = Object.fromEntries(DEFAULT_TEMPLATES.map((t) => [t.key, t]));

/** Normaliza a resposta do paciente para comparar com palavras-chave. */
export function keyword(text?: string | null) {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/)[0] ?? '';
}
