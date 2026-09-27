import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../common/prisma.service';
import { Ctx, Public, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { config } from '../../common/config';
import { ScheduleModule } from '../schedule/schedule.module';
import { CrmModule } from '../crm/crm.module';
import { PatientsService } from '../crm/patients.service';
import { MessagingService } from './messaging.service';
import { InboundService } from './inbound.service';
import { RemindersService } from './reminders.service';
import { canonicalPhone } from './templates';
import {
  AssignDto, ConversationStatusDto, LinkConversationDto, ListConversationsQuery, RunRemindersDto, SendMessageDto, SimulateInboundDto, UpdateTemplateDto,
} from './communication.dto';

@Controller()
export class CommunicationController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly inbound: InboundService,
    private readonly reminders: RemindersService,
    private readonly patients: PatientsService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermissions('messages.read')
  @Get('communication/status')
  async status(@Ctx() ctx: RequestContext) {
    const cfg = await this.prisma.integrationConfig.findUnique({ where: { organizationId_provider: { organizationId: ctx.user.organizationId, provider: 'WHATSAPP_CLOUD' } } });
    const base = process.env.API_PUBLIC_URL ?? `http://localhost:${config.port}/api/v1`;
    return {
      mode: this.messaging.provider.mode,
      phoneNumberId: (cfg?.publicConfig as { phoneNumberId?: string } | null)?.phoneNumberId ?? null,
      webhookUrl: `${base}/webhooks/whatsapp`,
      remindersEnabled: process.env.REMINDERS_ENABLED !== '0',
    };
  }

  // ───────── conversas ─────────

  @RequirePermissions('messages.read')
  @Get('conversations')
  list(@Ctx() ctx: RequestContext, @Query() q: ListConversationsQuery) {
    return this.messaging.list(ctx, q);
  }

  @RequirePermissions('messages.read')
  @Get('conversations/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.get(ctx, id);
  }

  @RequirePermissions('messages.send')
  @Post('conversations/:id/messages')
  async send(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    await this.messaging.find(ctx, id);
    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id }, include: { patient: { select: { name: true } }, lead: { select: { name: true } } } });
    const name = conv.patient?.name ?? conv.lead?.name ?? '';
    return this.messaging.send(ctx, id, { body: dto.body, templateKey: dto.templateKey, vars: { paciente: name.split(' ')[0], nome: name.split(' ')[0] } });
  }

  @RequirePermissions('messages.send')
  @Patch('conversations/:id/assign')
  assign(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.messaging.assign(ctx, id, dto.userId ?? null);
  }

  @RequirePermissions('messages.send')
  @Patch('conversations/:id/status')
  setStatus(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConversationStatusDto) {
    return this.messaging.setStatus(ctx, id, dto.status);
  }

  @RequirePermissions('messages.send')
  @Patch('conversations/:id/link')
  link(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkConversationDto) {
    return this.messaging.link(ctx, id, dto);
  }

  // ───────── paciente ─────────

  @RequirePermissions('messages.read')
  @Get('patients/:patientId/messages')
  async patientMessages(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) patientId: string) {
    await this.patients.assertAccess(ctx, patientId);
    const { phone } = await this.messaging.patientPhone(ctx.user.organizationId, patientId);
    const conv = phone ? await this.prisma.conversation.findUnique({ where: { organizationId_channel_externalContact: { organizationId: ctx.user.organizationId, channel: 'WHATSAPP', externalContact: phone } } }) : null;
    const optedOut = await this.messaging.optedOut(ctx.user.organizationId, { patientId });
    if (!conv) return { phone, conversation: null, optedOut };
    return { phone, optedOut, conversation: await this.messaging.get({ ...ctx, user: { ...ctx.user, permissions: [...ctx.user.permissions, 'patients.read_all'] } }, conv.id) };
  }

  @RequirePermissions('messages.send')
  @Post('patients/:patientId/messages')
  async sendToPatient(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) patientId: string, @Body() dto: SendMessageDto) {
    await this.patients.assertAccess(ctx, patientId);
    const { patient, phone } = await this.messaging.patientPhone(ctx.user.organizationId, patientId);
    if (!phone) throw new ForbiddenException('Paciente sem WhatsApp ou telefone cadastrado');
    const conv = await this.messaging.conversationForPhone(ctx.user.organizationId, phone, { patientId });
    return this.messaging.send(ctx, conv.id, { body: dto.body, templateKey: dto.templateKey, vars: { paciente: patient.name.split(' ')[0] } });
  }

  // ───────── modelos e lembretes ─────────

  @RequirePermissions('messages.read')
  @Get('communication/templates')
  templates(@Ctx() ctx: RequestContext) {
    return this.messaging.listTemplates(ctx);
  }

  @RequirePermissions('automations.manage')
  @Put('communication/templates/:id')
  updateTemplate(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.messaging.updateTemplate(ctx, id, dto);
  }

  @RequirePermissions('automations.manage')
  @Post('communication/reminders/run')
  @HttpCode(200)
  runReminders(@Ctx() ctx: RequestContext, @Body() dto: RunRemindersDto) {
    return this.reminders.run(ctx.user.organizationId, { includeRecent: dto.includeRecent ?? true });
  }

  /** Simulador (somente no modo demonstração): mensagem "recebida" de um número, como se viesse do WhatsApp. */
  @RequirePermissions('messages.send')
  @Post('communication/simulate')
  async simulate(@Ctx() ctx: RequestContext, @Body() dto: SimulateInboundDto) {
    if (this.messaging.provider.mode !== 'mock') throw new ForbiddenException('O simulador só funciona no modo demonstração');
    const from = canonicalPhone(dto.from);
    if (!from) throw new ForbiddenException('Telefone inválido');
    return this.inbound.handle(ctx.user.organizationId, { kind: 'message', from, text: dto.text, profileName: dto.name, externalId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, receivedAt: new Date() });
  }
}

/**
 * Webhook oficial do WhatsApp (Cloud API). Público, protegido pela assinatura X-Hub-Signature-256.
 * A organização é identificada pelo phone_number_id que recebeu a mensagem.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly inbound: InboundService,
    private readonly messaging: MessagingService,
  ) {}

  @Public()
  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    if (mode === 'subscribe' && this.messaging.provider.mode === 'real' && this.messaging.provider.verifyToken(token)) return res.status(200).type('text/plain').send(challenge);
    return res.status(403).send('forbidden');
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') signature?: string) {
    if (this.messaging.provider.mode !== 'real') throw new ForbiddenException('WhatsApp em modo demonstração: use o simulador da tela Comunicação');
    const events = this.messaging.provider.parseWebhook(req.rawBody ?? Buffer.from(''), signature);
    let processed = 0;
    for (const ev of events) {
      const org = await this.inbound.organizationForPhoneNumberId(ev.phoneNumberId);
      if (!org) continue;
      await this.inbound.handle(org, ev);
      processed++;
    }
    return { received: events.length, processed };
  }
}

@Module({
  imports: [ScheduleModule, CrmModule],
  controllers: [CommunicationController, WhatsAppWebhookController],
  providers: [MessagingService, InboundService, RemindersService],
  exports: [MessagingService],
})
export class CommunicationModule {}
