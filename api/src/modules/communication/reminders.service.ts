import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { systemContext } from '../../common/helpers';
import { MessagingService } from './messaging.service';
import { appointmentVars, firstName } from './templates';

const H = 3600e3;

/**
 * Lembretes automáticos de sessão pelo WhatsApp:
 *  - 24 h antes (entre 24 h e 3 h antes do horário), pedindo CONFIRMAR / REAGENDAR / CANCELAR;
 *  - 2 h antes (entre 2 h 15 e o horário).
 * Roda a cada minuto; cada lembrete é "reservado" em message_dispatches antes do envio,
 * então nunca sai duplicado — nem com várias instâncias da API.
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Reminders');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  onModuleInit() {
    if (process.env.REMINDERS_ENABLED === '0') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.prisma.appointment.findMany({
        where: { startsAt: { gt: new Date(), lte: new Date(Date.now() + 24 * H) }, status: { in: ['SCHEDULED', 'CONFIRMED'] }, patientId: { not: null } },
        distinct: ['organizationId'],
        select: { organizationId: true },
      });
      for (const o of orgs) await this.run(o.organizationId);
    } catch (e) {
      this.logger.error(`Falha nos lembretes: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Envia os lembretes devidos de uma clínica. Retorna o que foi enviado e o que foi pulado (e por quê). */
  async run(organizationId: string, opts: { includeRecent?: boolean } = {}) {
    const now = Date.now();
    const ctx = systemContext(organizationId, 'Lembretes automáticos');
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId } });
    const due = await this.prisma.appointment.findMany({
      where: { organizationId, startsAt: { gt: new Date(now), lte: new Date(now + 24 * H) }, status: { in: ['SCHEDULED', 'CONFIRMED'] }, patientId: { not: null } },
      include: { patient: { select: { id: true, name: true } }, professional: { select: { name: true } }, service: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
    });
    const result = { sent: 0, skipped: [] as { appointmentId: string; key: string; reason: string }[] };
    for (const a of due) {
      const left = a.startsAt.getTime() - now;
      let key: 'reminder_24h' | 'reminder_2h' | null = null;
      // Agendado há menos de 30 min: o paciente acabou de combinar o horário, não precisa de lembrete
      // (a não ser no disparo manual "Enviar lembretes agora").
      if (!opts.includeRecent && a.createdAt.getTime() > now - 30 * 60e3) continue;
      if (left <= 2.25 * H) key = 'reminder_2h';
      else if (left > 3 * H) key = 'reminder_24h';
      if (!key) continue;
      // Reserva (idempotência): se já existe, outro ciclo já cuidou deste lembrete.
      let dispatchId: string;
      try {
        dispatchId = (await this.prisma.messageDispatch.create({ data: { organizationId, key, entityId: a.id } })).id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
      const r = await this.messaging.sendToPatientAutomated(ctx, a.patient!.id, key, {
        paciente: firstName(a.patient!.name),
        clinica: settings.clinicName,
        ...appointmentVars(a),
      });
      if ('message' in r && r.message) {
        await this.prisma.messageDispatch.update({ where: { id: dispatchId }, data: { conversationId: r.conversationId, messageId: r.message.id } });
        if (r.message.status !== 'FAILED') result.sent++;
        else result.skipped.push({ appointmentId: a.id, key, reason: 'falha no envio' });
      } else {
        result.skipped.push({ appointmentId: a.id, key, reason: ('skipped' in r && r.skipped) || 'desconhecido' });
      }
    }
    if (result.sent) this.logger.log(`${result.sent} lembrete(s) enviados (${organizationId})`);
    return result;
  }
}
