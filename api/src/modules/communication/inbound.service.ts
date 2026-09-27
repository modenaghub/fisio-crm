import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Conversation, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { EventsService } from '../../common/events';
import { systemContext } from '../../common/helpers';
import { AuditService } from '../audit/audit.service';
import { ScheduleService } from '../schedule/schedule.service';
import { NotificationsService } from '../notifications/notifications.module';
import type { InboundWhatsAppMessage } from '../../integrations/whatsapp/whatsapp.provider';
import { MessagingService } from './messaging.service';
import { appointmentVars, canonicalPhone, firstName, formatPhone, keyword } from './templates';

const CONFIRM = new Set(['CONFIRMAR', 'CONFIRMO', 'CONFIRMADO', 'SIM', 'OK']);
const RESCHEDULE = new Set(['REAGENDAR', 'REMARCAR']);
const CANCEL = new Set(['CANCELAR', 'CANCELA']);
const OPT_OUT = new Set(['SAIR', 'PARAR', 'DESCADASTRAR']);
const OPT_IN = new Set(['VOLTAR']);
const PERIODS: Record<string, string> = { '1': 'manhã', MANHA: 'manhã', '2': 'tarde', TARDE: 'tarde', '3': 'noite', NOITE: 'noite' };

interface BotState {
  step: 'name' | 'reason' | 'period' | 'done' | 'human';
  answers: { name?: string; reason?: string; period?: string };
}

/**
 * Processa o que chega pelo webhook do WhatsApp:
 *  - respostas aos lembretes (CONFIRMAR / REAGENDAR / CANCELAR) agem na agenda;
 *  - número desconhecido passa pelo robô de primeiro contato, que cria o lead no CRM;
 *  - SAIR / VOLTAR registram a revogação ou retomada do consentimento (LGPD);
 *  - o restante vai para a fila de atendimento humano, com notificação.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger('WhatsAppInbound');

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly schedule: ScheduleService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** Organização dona do número que recebeu a mensagem (Cloud API: phone_number_id). */
  async organizationForPhoneNumberId(phoneNumberId?: string) {
    if (!phoneNumberId) return null;
    const cfg = await this.prisma.integrationConfig.findFirst({ where: { provider: 'WHATSAPP_CLOUD', publicConfig: { path: ['phoneNumberId'], equals: phoneNumberId } } });
    return cfg?.organizationId ?? null;
  }

  async handle(organizationId: string, ev: InboundWhatsAppMessage) {
    if (ev.kind === 'status') return this.handleStatus(organizationId, ev);
    const phone = canonicalPhone(ev.from);
    if (!phone) return { ignored: 'telefone inválido' };
    // Idempotência: a Meta reenvia o webhook se não receber 200 a tempo.
    if (ev.externalId && (await this.prisma.message.findFirst({ where: { organizationId, externalId: ev.externalId }, select: { id: true } }))) return { duplicate: true };

    let conv = await this.prisma.conversation.findUnique({ where: { organizationId_channel_externalContact: { organizationId, channel: 'WHATSAPP', externalContact: phone } } });
    if (!conv || (!conv.patientId && !conv.leadId)) {
      const match = await this.messaging.matchContact(organizationId, phone);
      conv = await this.messaging.conversationForPhone(organizationId, phone, match ?? undefined);
    }
    const text = (ev.text ?? ev.buttonPayload ?? '').trim();
    const now = new Date();
    const wasUnread = conv.unreadCount;
    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: { organizationId, conversationId: conv!.id, channel: 'WHATSAPP', direction: 'INBOUND', from: phone, body: text || '(mensagem sem texto)', status: 'RECEIVED', externalId: ev.externalId, isMock: this.messaging.provider.mode === 'mock' },
      });
      conv = await tx.conversation.update({
        where: { id: conv!.id },
        data: { lastMessageAt: now, serviceWindowEndsAt: new Date(now.getTime() + 24 * 3600e3), unreadCount: { increment: 1 }, ...(conv!.status === 'CLOSED' ? { status: conv!.assignedToId ? 'ASSIGNED' : 'OPEN' } : {}) },
      });
      if (conv.patientId) await tx.patient.update({ where: { id: conv.patientId }, data: { lastContactAt: now } });
      if (conv.leadId) await tx.lead.update({ where: { id: conv.leadId }, data: { lastContactAt: now } });
      return m;
    });
    this.events.emit('message.received', { organizationId, entityId: msg.id, data: { conversationId: conv.id, patientId: conv.patientId, leadId: conv.leadId } });

    const ctx = systemContext(organizationId, 'Assistente WhatsApp');
    const kw = keyword(text);
    let handled: string | null = null;

    if (OPT_OUT.has(kw) || OPT_IN.has(kw)) handled = await this.consent(ctx, conv, OPT_OUT.has(kw), msg.id);
    else if (conv.status === 'BOT' && !conv.patientId && !conv.leadId) handled = await this.bot(ctx, conv, text, ev.profileName, msg.id);
    else if (conv.patientId && (CONFIRM.has(kw) || RESCHEDULE.has(kw) || CANCEL.has(kw))) handled = await this.reminderReply(ctx, conv, kw);

    // Mensagens resolvidas pelo robô não ficam como "não lidas"; as demais vão para a equipe.
    if (handled && handled !== 'reschedule' && handled !== 'no_appointment') {
      await this.prisma.conversation.update({ where: { id: conv.id }, data: { unreadCount: 0 } });
    } else if (!handled || handled === 'reschedule' || handled === 'no_appointment') {
      const fresh = await this.prisma.conversation.findUniqueOrThrow({ where: { id: conv.id }, include: { patient: { select: { name: true, responsibleId: true } }, lead: { select: { name: true } } } });
      if (fresh.status === 'BOT') await this.prisma.conversation.update({ where: { id: conv.id }, data: { status: 'OPEN' } });
      if (!wasUnread) {
        const who = fresh.patient?.name ?? fresh.lead?.name ?? formatPhone(phone);
        await this.notifications.notify(
          organizationId,
          fresh.assignedToId ? { userIds: [fresh.assignedToId] } : { permission: 'messages.send', userIds: [fresh.patient?.responsibleId] },
          { type: 'NEW_MESSAGE', title: `Nova mensagem de ${who}`, body: text.slice(0, 140), link: `/comunicacao?c=${conv.id}` },
        );
      }
    }
    return { conversationId: conv.id, messageId: msg.id, handled };
  }

  private async handleStatus(organizationId: string, ev: InboundWhatsAppMessage) {
    const map = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' } as const;
    if (!ev.status) return { ignored: true };
    const r = await this.prisma.message.updateMany({ where: { organizationId, externalId: ev.externalId, direction: 'OUTBOUND' }, data: { status: map[ev.status], errorMessage: ev.errorMessage ?? undefined } });
    return { updated: r.count };
  }

  private reply(ctx: ReturnType<typeof systemContext>, conv: Conversation, templateKey: string, vars: Record<string, string | number | null | undefined> = {}) {
    return this.messaging.send(ctx, conv.id, { templateKey, vars, automated: true, buttons: templateKey === 'bot_ask_period' ? undefined : [] }).catch((e) => this.logger.warn(`Resposta automática falhou: ${(e as Error).message}`));
  }

  // ───────────── LGPD: SAIR / VOLTAR ─────────────

  private async consent(ctx: ReturnType<typeof systemContext>, conv: Conversation, optOut: boolean, messageId: string) {
    const org = ctx.user.organizationId;
    const who = conv.patientId ? { patientId: conv.patientId } : conv.leadId ? { leadId: conv.leadId } : null;
    if (who) {
      if (optOut) {
        const updated = await this.prisma.consent.updateMany({ where: { organizationId: org, purpose: 'WHATSAPP_COMMUNICATION', revokedAt: null, ...who }, data: { revokedAt: new Date() } });
        if (!updated.count) await this.prisma.consent.create({ data: { organizationId: org, purpose: 'WHATSAPP_COMMUNICATION', termVersion: 'v1', channel: 'whatsapp', ...who, revokedAt: new Date(), evidence: { messageId, action: 'opt_out' } } });
      } else {
        await this.prisma.consent.create({ data: { organizationId: org, purpose: 'WHATSAPP_COMMUNICATION', termVersion: 'v1', channel: 'whatsapp', ...who, evidence: { messageId, action: 'opt_in' } } });
      }
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: conv.patientId ? 'patient' : 'lead', entityId: conv.patientId ?? conv.leadId, summary: optOut ? 'Pediu para não receber mensagens automáticas (WhatsApp)' : 'Voltou a aceitar mensagens automáticas (WhatsApp)' });
    }
    await this.reply(ctx, conv, optOut ? 'reply_opt_out' : 'reply_opt_in');
    return optOut ? 'opt_out' : 'opt_in';
  }

  // ───────────── respostas aos lembretes ─────────────

  /** Agendamento a que o paciente está respondendo: o do último lembrete enviado; senão, o próximo em até 7 dias. */
  private async targetAppointment(organizationId: string, conv: Conversation) {
    const now = new Date();
    const active = { status: { in: ['SCHEDULED', 'CONFIRMED'] as ('SCHEDULED' | 'CONFIRMED')[] }, startsAt: { gt: now } };
    const include = { professional: { select: { id: true, name: true } }, service: { select: { name: true } }, patient: { select: { name: true } } };
    const dispatches = await this.prisma.messageDispatch.findMany({ where: { organizationId, conversationId: conv.id, key: { startsWith: 'reminder_' } }, orderBy: { createdAt: 'desc' }, take: 5 });
    for (const d of dispatches) {
      const a = await this.prisma.appointment.findFirst({ where: { id: d.entityId, organizationId, ...active }, include });
      if (a) return a;
    }
    return this.prisma.appointment.findFirst({
      where: { organizationId, patientId: conv.patientId!, ...active, startsAt: { gt: now, lt: new Date(now.getTime() + 7 * 86400e3) } },
      orderBy: { startsAt: 'asc' },
      include,
    });
  }

  private async reminderReply(ctx: ReturnType<typeof systemContext>, conv: Conversation, kw: string) {
    const org = ctx.user.organizationId;
    const a = await this.targetAppointment(org, conv);
    if (!a) {
      await this.reply(ctx, conv, 'reply_no_appointment');
      return 'no_appointment';
    }
    const vars = appointmentVars(a);
    const who = a.patient?.name ?? 'Paciente';
    if (CONFIRM.has(kw)) {
      if (a.status !== 'CONFIRMED') await this.schedule.setStatus(ctx, a.id, { status: 'CONFIRMED', channel: 'whatsapp' }, 'whatsapp');
      await this.reply(ctx, conv, 'reply_confirmed', vars);
      return 'confirmed';
    }
    if (CANCEL.has(kw)) {
      const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: org } });
      const late = a.startsAt.getTime() - Date.now() < settings.cancellationNoticeHours * 3600e3;
      await this.schedule.setStatus(ctx, a.id, { status: 'CANCELLED', channel: 'whatsapp', reason: `Cancelado pelo paciente pelo WhatsApp${late ? ` (menos de ${settings.cancellationNoticeHours} h de antecedência)` : ''}` }, 'whatsapp');
      await this.reply(ctx, conv, 'reply_cancelled', vars);
      await this.notifications.notify(org, { permission: 'schedule.write', userIds: [a.professional.id] }, {
        type: 'SYSTEM', title: `${who} cancelou a sessão de ${vars.data}, ${vars.hora}`, body: late ? 'Cancelamento fora do prazo mínimo.' : 'Horário liberado na agenda.', link: `/agenda?data=${a.startsAt.toISOString().slice(0, 10)}`,
      });
      return 'cancelled';
    }
    // REAGENDAR: vira tarefa para a recepção escolher o novo horário com o paciente.
    await this.prisma.task.create({
      data: {
        organizationId: org, title: `Remarcar sessão de ${who} (${vars.data}, ${vars.hora})`, type: 'RESCHEDULE', priority: 'HIGH',
        dueAt: new Date(Date.now() + 2 * 3600e3), patientId: conv.patientId, notes: 'Pedido feito pelo WhatsApp em resposta ao lembrete.',
      },
    });
    await this.reply(ctx, conv, 'reply_reschedule');
    await this.notifications.notify(org, { permission: 'schedule.write' }, { type: 'SYSTEM', title: `${who} pediu para remarcar`, body: `Sessão de ${vars.data}, ${vars.hora}`, link: `/comunicacao?c=${conv.id}` });
    return 'reschedule';
  }

  // ───────────── robô de primeiro contato ─────────────

  private async bot(ctx: ReturnType<typeof systemContext>, conv: Conversation, text: string, profileName: string | undefined, messageId: string) {
    const state: BotState = (conv.botState as unknown as BotState) ?? { step: 'name', answers: {} };
    const save = (s: BotState) => this.prisma.conversation.update({ where: { id: conv.id }, data: { botState: s as unknown as Prisma.InputJsonValue } });

    if (!conv.botState) {
      await save({ step: 'name', answers: {} });
      await this.reply(ctx, conv, 'bot_welcome');
      return 'bot';
    }
    if (state.step === 'name') {
      const name = text.replace(/\s+/g, ' ').trim();
      if (name.length < 3 || /\d/.test(name)) {
        await this.reply(ctx, conv, 'bot_welcome');
        return 'bot';
      }
      state.answers.name = name.slice(0, 120);
      state.step = 'reason';
      await save(state);
      await this.reply(ctx, conv, 'bot_ask_reason', { nome: firstName(name) });
      return 'bot';
    }
    if (state.step === 'reason') {
      state.answers.reason = text.slice(0, 300);
      state.step = 'period';
      await save(state);
      await this.reply(ctx, conv, 'bot_ask_period');
      return 'bot';
    }
    if (state.step === 'period') {
      const p = PERIODS[keyword(text)] ?? PERIODS[keyword(text).slice(0, 1)];
      if (!p) {
        await this.reply(ctx, conv, 'bot_ask_period');
        return 'bot';
      }
      state.answers.period = p;
      state.step = 'done';
      const lead = await this.createLead(ctx, conv, state, profileName, messageId);
      await this.reply(ctx, { ...conv, leadId: lead.id }, 'bot_done', { nome: firstName(state.answers.name) });
      return 'lead_created';
    }
    return null;
  }

  private async createLead(ctx: ReturnType<typeof systemContext>, conv: Conversation, state: BotState, profileName: string | undefined, messageId: string) {
    const org = ctx.user.organizationId;
    const name = state.answers.name ?? profileName ?? formatPhone(conv.externalContact);
    const lead = await this.prisma.$transaction(async (tx) => {
      const l = await tx.lead.create({
        data: {
          organizationId: org, name, phone: formatPhone(conv.externalContact), phoneDigits: conv.externalContact.slice(2), source: 'WHATSAPP', stage: 'NEW_CONTACT',
          temperature: 'WARM', reason: state.answers.reason ?? null, intakeAnswers: { ...state.answers, canal: 'robô WhatsApp' }, lastContactAt: new Date(),
        },
      });
      await tx.consent.create({ data: { organizationId: org, leadId: l.id, purpose: 'WHATSAPP_COMMUNICATION', termVersion: 'v1', channel: 'whatsapp', evidence: { messageId, note: 'Contato iniciado pelo paciente; aviso de LGPD na mensagem de boas-vindas.' } } });
      await tx.conversation.update({ where: { id: conv.id }, data: { leadId: l.id, status: 'OPEN', botState: state as unknown as Prisma.InputJsonValue } });
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'lead', entityId: l.id, summary: `Lead ${name} criado pelo robô do WhatsApp` }, tx);
      return l;
    });
    this.events.emit('lead.created', { organizationId: org, entityId: lead.id, data: { source: 'WHATSAPP' } });
    await this.notifications.notify(org, { permission: 'leads.write' }, {
      type: 'NEW_LEAD', title: `Novo lead pelo WhatsApp: ${name}`, body: [state.answers.reason, state.answers.period && `prefere ${state.answers.period}`].filter(Boolean).join(' · '), link: `/comunicacao?c=${conv.id}`,
    });
    return lead;
  }
}
