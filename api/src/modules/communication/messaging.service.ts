import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, ConversationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { RequestContext } from '../../common/auth/auth.types';
import { actorId, can, digits, paginate, patientScope } from '../../common/helpers';
import { AuditService } from '../audit/audit.service';
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from '../../integrations/whatsapp/whatsapp.provider';
import { canonicalPhone, DEFAULT_TEMPLATES, formatPhone, localVariants, render, TEMPLATE_META } from './templates';

const WINDOW_MS = 24 * 3600e3;

const convInclude = {
  patient: { select: { id: true, name: true, photoUrl: true, responsibleId: true } },
  lead: { select: { id: true, name: true, stage: true } },
  assignedTo: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, direction: true, createdAt: true, status: true } },
} satisfies Prisma.ConversationInclude;

type ConvRow = Prisma.ConversationGetPayload<{ include: typeof convInclude }>;

export interface SendOptions {
  body?: string;
  templateKey?: string;
  vars?: Record<string, string | number | null | undefined>;
  automated?: boolean;
  /** Botões de resposta rápida; por padrão, os do modelo. */
  buttons?: string[];
}

/**
 * Conversas e envio de mensagens (WhatsApp).
 * Regra da Meta respeitada: texto livre só dentro de 24 h após a última mensagem do contato;
 * fora dessa janela só vão modelos aprovados (whatsappTemplateName).
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger('Messaging');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(WHATSAPP_PROVIDER) readonly provider: WhatsAppProvider,
  ) {}

  // ───────────── modelos ─────────────

  /** Garante os modelos padrão (clínicas antigas ganham os que faltam, sem sobrescrever textos editados). */
  async ensureTemplates(organizationId: string) {
    const keys = DEFAULT_TEMPLATES.map((t) => t.key);
    const approved = DEFAULT_TEMPLATES.filter((t) => t.whatsappTemplateName);
    const [count, withName] = await Promise.all([
      this.prisma.messageTemplate.count({ where: { organizationId, channel: 'WHATSAPP', key: { in: keys } } }),
      this.prisma.messageTemplate.count({ where: { organizationId, channel: 'WHATSAPP', key: { in: approved.map((t) => t.key) }, whatsappTemplateName: { not: null } } }),
    ]);
    if (count >= keys.length && withName >= approved.length) return;
    await this.prisma.messageTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ organizationId, key: t.key, channel: 'WHATSAPP' as const, name: t.name, body: t.body, buttons: t.buttons ?? [], whatsappTemplateName: t.whatsappTemplateName ?? null })),
      skipDuplicates: true,
    });
    for (const t of approved) {
      await this.prisma.messageTemplate.updateMany({ where: { organizationId, channel: 'WHATSAPP', key: t.key, whatsappTemplateName: null }, data: { whatsappTemplateName: t.whatsappTemplateName, body: t.body, name: t.name, buttons: t.buttons ?? [] } });
    }
  }

  async template(organizationId: string, key: string) {
    await this.ensureTemplates(organizationId);
    return this.prisma.messageTemplate.findUnique({ where: { organizationId_key_channel: { organizationId, key, channel: 'WHATSAPP' } } });
  }

  async listTemplates(ctx: RequestContext) {
    await this.ensureTemplates(ctx.user.organizationId);
    const rows = await this.prisma.messageTemplate.findMany({ where: { organizationId: ctx.user.organizationId, channel: 'WHATSAPP', key: { in: DEFAULT_TEMPLATES.map((t) => t.key) } } });
    const order = DEFAULT_TEMPLATES.map((t) => t.key);
    return rows
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
      .map((t) => ({ ...t, group: TEMPLATE_META[t.key]?.group ?? 'relacionamento', variables: TEMPLATE_META[t.key]?.variables ?? [], defaultBody: TEMPLATE_META[t.key]?.body ?? null }));
  }

  async updateTemplate(ctx: RequestContext, id: string, dto: { body?: string; isActive?: boolean; whatsappTemplateName?: string | null; buttons?: string[] }) {
    const t = await this.prisma.messageTemplate.findFirst({ where: { id, organizationId: ctx.user.organizationId } });
    if (!t) throw new NotFoundException('Modelo não encontrado');
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.messageTemplate.update({ where: { id }, data: dto });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'message_template', entityId: id, summary: `Modelo "${t.name}" alterado`, changes: AuditService.diff({ body: t.body, isActive: t.isActive, whatsappTemplateName: t.whatsappTemplateName }, { body: u.body, isActive: u.isActive, whatsappTemplateName: u.whatsappTemplateName }) }, tx);
      return u;
    });
    return updated;
  }

  // ───────────── conversas ─────────────

  /** Encontra paciente e, se não houver, lead com o mesmo telefone. */
  async matchContact(organizationId: string, phone: string) {
    const variants = localVariants(phone);
    const phoneOr = variants.map((v) => ({ phoneDigits: { contains: v } }));
    const patient = await this.prisma.patient.findFirst({ where: { organizationId, deletedAt: null, anonymizedAt: null, OR: phoneOr }, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true } });
    if (patient) return { patientId: patient.id, leadId: null as string | null, name: patient.name };
    const lead = await this.prisma.lead.findFirst({ where: { organizationId, deletedAt: null, patientId: null, OR: phoneOr }, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true } });
    if (lead) return { patientId: null as string | null, leadId: lead.id, name: lead.name };
    return null;
  }

  async conversationForPhone(organizationId: string, phone: string, link?: { patientId?: string | null; leadId?: string | null }) {
    const existing = await this.prisma.conversation.findUnique({ where: { organizationId_channel_externalContact: { organizationId, channel: 'WHATSAPP', externalContact: phone } } });
    if (existing) {
      if (link && ((link.patientId && existing.patientId !== link.patientId) || (!existing.leadId && link.leadId))) {
        return this.prisma.conversation.update({ where: { id: existing.id }, data: { patientId: link.patientId ?? existing.patientId, leadId: link.leadId ?? existing.leadId } });
      }
      return existing;
    }
    try {
      return await this.prisma.conversation.create({
        data: { organizationId, channel: 'WHATSAPP', externalContact: phone, patientId: link?.patientId ?? null, leadId: link?.leadId ?? null, status: link?.patientId || link?.leadId ? 'OPEN' : 'BOT' },
      });
    } catch (e) {
      // Corrida com outro webhook para o mesmo número.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.conversation.findUniqueOrThrow({ where: { organizationId_channel_externalContact: { organizationId, channel: 'WHATSAPP', externalContact: phone } } });
      }
      throw e;
    }
  }

  /** Conversas visíveis: fisioterapeuta (sem patients.read_all) vê só as dos seus pacientes ou atribuídas a ele. */
  scope(ctx: RequestContext): Prisma.ConversationWhereInput {
    const base: Prisma.ConversationWhereInput = { organizationId: ctx.user.organizationId, channel: 'WHATSAPP' };
    if (can(ctx, 'patients.read_all')) return base;
    return { ...base, OR: [{ assignedToId: ctx.user.id }, { patient: patientScope(ctx) }] };
  }

  present(c: ConvRow) {
    const answers = (c.botState as { answers?: { name?: string } } | null)?.answers;
    return {
      id: c.id,
      status: c.status,
      phone: c.externalContact,
      phoneFormatted: formatPhone(c.externalContact),
      contactName: c.patient?.name ?? c.lead?.name ?? answers?.name ?? null,
      patient: c.patient ? { id: c.patient.id, name: c.patient.name, photoUrl: c.patient.photoUrl } : null,
      lead: c.lead,
      assignedTo: c.assignedTo,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt,
      windowOpen: !!c.serviceWindowEndsAt && c.serviceWindowEndsAt > new Date(),
      serviceWindowEndsAt: c.serviceWindowEndsAt,
      lastMessage: c.messages[0] ?? null,
      botStep: (c.botState as { step?: string } | null)?.step ?? null,
    };
  }

  async list(ctx: RequestContext, q: { status?: string; search?: string; page?: number }) {
    const where: Prisma.ConversationWhereInput = { ...this.scope(ctx) };
    const and: Prisma.ConversationWhereInput[] = [];
    if (q.status === 'mine') and.push({ assignedToId: ctx.user.id, status: { not: 'CLOSED' } });
    else if (q.status === 'unread') and.push({ unreadCount: { gt: 0 } });
    else if (q.status === 'active') and.push({ status: { not: 'CLOSED' } });
    else if (q.status && q.status in ConversationStatus) and.push({ status: q.status as ConversationStatus });
    const term = q.search?.trim();
    if (term) {
      const d = digits(term);
      and.push({
        OR: [
          { patient: { name: { contains: term, mode: 'insensitive' } } },
          { lead: { name: { contains: term, mode: 'insensitive' } } },
          ...(d.length >= 4 ? [{ externalContact: { contains: d } }] : []),
        ],
      });
    }
    if (and.length) where.AND = and;
    const pg = paginate(q.page, 30);
    const [rows, total, counts] = await Promise.all([
      this.prisma.conversation.findMany({ where, include: convInclude, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], skip: pg.skip, take: pg.take }),
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.groupBy({ by: ['status'], where: this.scope(ctx), _count: true }),
    ]);
    const unread = await this.prisma.conversation.count({ where: { ...this.scope(ctx), unreadCount: { gt: 0 } } });
    const n = (s: ConversationStatus) => counts.find((c) => c.status === s)?._count ?? 0;
    return {
      items: rows.map((r) => this.present(r)),
      total,
      page: pg.page,
      pageSize: pg.pageSize,
      counts: { BOT: n('BOT'), OPEN: n('OPEN'), ASSIGNED: n('ASSIGNED'), CLOSED: n('CLOSED'), unread },
    };
  }

  async find(ctx: RequestContext, id: string) {
    const c = await this.prisma.conversation.findFirst({ where: { ...this.scope(ctx), id }, include: convInclude });
    if (!c) throw new NotFoundException('Conversa não encontrada');
    return c;
  }

  async get(ctx: RequestContext, id: string, markRead = true) {
    const c = await this.find(ctx, id);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, direction: true, body: true, status: true, isAutomated: true, isMock: true, errorMessage: true, createdAt: true, sentBy: { select: { id: true, name: true } }, template: { select: { key: true, name: true } } },
    });
    if (markRead && c.unreadCount) await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    await this.audit.recordRead(ctx, 'conversation', id, `Conversa com ${c.patient?.name ?? c.lead?.name ?? formatPhone(c.externalContact)} consultada`);
    return { ...this.present({ ...c, unreadCount: markRead ? 0 : c.unreadCount }), messages };
  }

  // ───────────── envio ─────────────

  /**
   * Envia pela conversa. Com `templateKey`, o texto vem do modelo (com variáveis);
   * fora da janela de 24 h só modelos com template aprovado são aceitos.
   */
  async send(ctx: RequestContext, conversationId: string, opts: SendOptions) {
    const conv = await this.prisma.conversation.findFirstOrThrow({ where: { id: conversationId, organizationId: ctx.user.organizationId } });
    const org = ctx.user.organizationId;
    const tpl = opts.templateKey ? await this.template(org, opts.templateKey) : null;
    if (opts.templateKey && !tpl) throw new BadRequestException('Modelo não encontrado');
    if (tpl && !tpl.isActive && opts.automated) return null;
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: org } });
    const vars = { clinica: settings.clinicName, ...(opts.vars ?? {}) };
    const body = (opts.body ?? (tpl ? render(tpl.body, vars) : '')).trim();
    if (!body) throw new BadRequestException('Mensagem vazia');
    const buttons = opts.buttons ?? tpl?.buttons ?? [];

    const now = new Date();
    const windowOpen = !!conv.serviceWindowEndsAt && conv.serviceWindowEndsAt > now;
    if (!windowOpen && !tpl?.whatsappTemplateName) {
      throw new ConflictException('Fora da janela de 24 h do WhatsApp: o paciente não escreveu nas últimas 24 horas. Envie um modelo aprovado (ex.: lembrete) ou aguarde a resposta dele.');
    }

    let externalId: string | null = null;
    let error: string | null = null;
    try {
      const r = windowOpen
        ? await this.provider.sendText({ to: conv.externalContact, body, buttons: buttons.length ? buttons : undefined })
        : await this.provider.sendTemplate({
            to: conv.externalContact,
            templateName: tpl!.whatsappTemplateName!,
            language: 'pt_BR',
            variables: (TEMPLATE_META[tpl!.key]?.variables ?? []).map((v) => String(vars[v as keyof typeof vars] ?? '')),
          });
      externalId = r.externalId;
    } catch (e) {
      error = (e as Error).message;
      this.logger.warn(`Falha ao enviar para ${conv.externalContact}: ${error}`);
    }

    const human = !!ctx.user.id && !opts.automated;
    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          organizationId: org, conversationId: conv.id, channel: 'WHATSAPP', direction: 'OUTBOUND', to: conv.externalContact, body,
          templateId: tpl?.id ?? null, status: error ? 'FAILED' : 'SENT', externalId, errorMessage: error,
          isAutomated: !!opts.automated, isMock: this.provider.mode === 'mock', sentById: human ? actorId(ctx) : null,
        },
      });
      await tx.conversation.update({
        where: { id: conv.id },
        data: {
          lastMessageAt: now,
          ...(human ? { unreadCount: 0 } : {}),
          // Atendente respondeu: sai do robô e fica atribuída a quem respondeu.
          ...(human && conv.status !== 'ASSIGNED' ? { status: 'ASSIGNED', assignedToId: conv.assignedToId ?? actorId(ctx) } : {}),
          ...(human && conv.status === 'BOT' ? { botState: { ...((conv.botState as object) ?? {}), step: 'human' } } : {}),
        },
      });
      if (conv.patientId) await tx.patient.update({ where: { id: conv.patientId }, data: { lastContactAt: now } });
      if (conv.leadId) await tx.lead.update({ where: { id: conv.leadId }, data: { lastContactAt: now } });
      return m;
    });
    if (error && human) throw new BadRequestException(`O WhatsApp recusou a mensagem: ${error}`);
    return msg;
  }

  /** Telefone de WhatsApp do paciente (WhatsApp, senão telefone). */
  async patientPhone(organizationId: string, patientId: string) {
    const p = await this.prisma.patient.findFirst({ where: { id: patientId, organizationId, deletedAt: null }, select: { id: true, name: true, whatsapp: true, phone: true, anonymizedAt: true } });
    if (!p) throw new NotFoundException('Paciente não encontrado');
    return { patient: p, phone: p.anonymizedAt ? null : canonicalPhone(p.whatsapp) ?? canonicalPhone(p.phone) };
  }

  async conversationForPatient(organizationId: string, patientId: string) {
    const { phone } = await this.patientPhone(organizationId, patientId);
    if (!phone) return null;
    return this.conversationForPhone(organizationId, phone, { patientId });
  }

  /** LGPD: o paciente pediu para não receber mensagens automáticas? */
  async optedOut(organizationId: string, who: { patientId?: string | null; leadId?: string | null }) {
    if (!who.patientId && !who.leadId) return false;
    const last = await this.prisma.consent.findFirst({
      where: { organizationId, purpose: 'WHATSAPP_COMMUNICATION', ...(who.patientId ? { patientId: who.patientId } : { leadId: who.leadId }) },
      orderBy: { grantedAt: 'desc' },
    });
    return !!last?.revokedAt;
  }

  /** Mensagem automática para um paciente (lembretes, automações). Respeita descadastro e modelo inativo. */
  async sendToPatientAutomated(ctx: RequestContext, patientId: string, templateKey: string, vars: Record<string, string | number | null | undefined>) {
    const org = ctx.user.organizationId;
    if (await this.optedOut(org, { patientId })) return { skipped: 'opt_out' as const };
    const tpl = await this.template(org, templateKey);
    if (!tpl?.isActive) return { skipped: 'inactive' as const };
    const conv = await this.conversationForPatient(org, patientId);
    if (!conv) return { skipped: 'no_phone' as const };
    try {
      const m = await this.send(ctx, conv.id, { templateKey, vars, automated: true });
      return { message: m, conversationId: conv.id };
    } catch (e) {
      return { skipped: 'error' as const, error: (e as Error).message };
    }
  }

  // ───────────── gestão ─────────────

  async assign(ctx: RequestContext, id: string, userId: string | null) {
    const c = await this.find(ctx, id);
    if (userId) {
      const u = await this.prisma.user.findFirst({ where: { id: userId, organizationId: ctx.user.organizationId, isActive: true } });
      if (!u) throw new BadRequestException('Usuário inválido');
    }
    await this.prisma.conversation.update({ where: { id }, data: { assignedToId: userId, status: userId ? 'ASSIGNED' : c.status === 'ASSIGNED' ? 'OPEN' : c.status } });
    return this.get(ctx, id, false);
  }

  async setStatus(ctx: RequestContext, id: string, status: 'OPEN' | 'CLOSED') {
    await this.find(ctx, id);
    await this.prisma.conversation.update({ where: { id }, data: { status, ...(status === 'CLOSED' ? { unreadCount: 0 } : {}) } });
    return this.get(ctx, id, false);
  }

  async link(ctx: RequestContext, id: string, dto: { patientId?: string; leadId?: string }) {
    const c = await this.find(ctx, id);
    if (dto.patientId) {
      const p = await this.prisma.patient.findFirst({ where: { ...patientScope(ctx), id: dto.patientId } });
      if (!p) throw new BadRequestException('Paciente inválido');
    }
    if (dto.leadId) {
      const l = await this.prisma.lead.findFirst({ where: { organizationId: ctx.user.organizationId, id: dto.leadId, deletedAt: null } });
      if (!l) throw new BadRequestException('Lead inválido');
    }
    await this.prisma.conversation.update({
      where: { id },
      data: { patientId: dto.patientId ?? c.patientId, leadId: dto.leadId ?? c.leadId, ...(c.status === 'BOT' ? { status: 'OPEN', botState: { ...((c.botState as object) ?? {}), step: 'human' } } : {}) },
    });
    await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'conversation', entityId: id, summary: `Conversa ${formatPhone(c.externalContact)} vinculada a ${dto.patientId ? 'paciente' : 'lead'}` });
    return this.get(ctx, id, false);
  }
}
