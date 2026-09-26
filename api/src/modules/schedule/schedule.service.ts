import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { AppointmentStatus, AuditAction, LeadStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { RequestContext } from '../../common/auth/auth.types';
import { EventsService } from '../../common/events';
import { addDays, can, dateOnly, localDateKey, localTime, localToUtc, notFound, patientScope } from '../../common/helpers';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from './availability.service';
import { AppointmentDto, MoveAppointmentDto, RecurringDto, RescheduleDto, StatusDto } from './schedule.dto';

const include = {
  patient: { select: { id: true, name: true, photoUrl: true, phone: true, whatsapp: true } },
  professional: { select: { id: true, name: true, professional: { select: { calendarColor: true } } } },
  service: { select: { id: true, name: true, kind: true, color: true } },
  package: { select: { id: true, name: true } },
  treatmentSession: { select: { id: true, sessionNumber: true } },
  evaluation: { select: { id: true } },
} satisfies Prisma.AppointmentInclude;

type Appt = Prisma.AppointmentGetPayload<{ include: typeof include }>;

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Agendado', CONFIRMED: 'Confirmado', IN_PROGRESS: 'Em atendimento', DONE: 'Realizado', CANCELLED: 'Cancelado', NO_SHOW: 'Faltou', RESCHEDULED: 'Reagendado', BLOCKED: 'Bloqueio',
};

const EDITABLE: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'BLOCKED'];

@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
    private readonly events: EventsService,
  ) {}

  present(a: Appt) {
    return {
      id: a.id,
      kind: a.status === 'BLOCKED' ? 'BLOCK' : 'APPOINTMENT',
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      durationMinutes: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
      status: a.status,
      statusLabel: STATUS_LABELS[a.status],
      priceCents: a.priceCents,
      notes: a.notes,
      cancelReason: a.cancelReason,
      unitId: a.unitId,
      seriesId: a.seriesId,
      rescheduledFromId: a.rescheduledFromId,
      confirmedAt: a.confirmedAt,
      patient: a.patient,
      professional: { id: a.professional.id, name: a.professional.name, color: a.professional.professional?.calendarColor ?? '#0f766e' },
      service: a.service,
      package: a.package,
      session: a.treatmentSession,
      hasEvaluation: !!a.evaluation,
    };
  }

  async defaultUnit(ctx: RequestContext, unitId?: string) {
    if (unitId) {
      const u = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId: ctx.user.organizationId } });
      if (!u) throw new BadRequestException('Unidade inválida');
      return u.id;
    }
    const link = await this.prisma.userUnit.findFirst({ where: { userId: ctx.user.id } });
    if (link) return link.unitId;
    const u = await this.prisma.unit.findFirstOrThrow({ where: { organizationId: ctx.user.organizationId }, orderBy: { createdAt: 'asc' } });
    return u.id;
  }

  private async assertProfessional(ctx: RequestContext, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, organizationId: ctx.user.organizationId, isActive: true, professional: { isNot: null } }, select: { id: true, name: true } });
    if (!u) throw new BadRequestException('Profissional inválido');
    return u;
  }

  private async assertPatient(ctx: RequestContext, id: string) {
    const p = await this.prisma.patient.findFirst({ where: { id, organizationId: ctx.user.organizationId, deletedAt: null }, select: { id: true, name: true } });
    if (!p) throw new BadRequestException('Paciente inválido');
    return p;
  }

  private async find(ctx: RequestContext, id: string) {
    const a = await this.prisma.appointment.findFirst({ where: { id, organizationId: ctx.user.organizationId }, include });
    if (!a) notFound('Agendamento');
    return a;
  }

  /** Verifica horário de atendimento e conflitos; lança 409 com detalhes quando não pode agendar. */
  async check(ctx: RequestContext, p: { unitId: string; professionalId: string; start: Date; end: Date; force?: boolean; excludeId?: string; isBlock?: boolean }) {
    if (p.end <= p.start) throw new BadRequestException('O término deve ser depois do início');
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: ctx.user.organizationId } });
    const conflicts = await this.availability.busy(ctx.user.organizationId, p.professionalId, p.start, p.end, p.excludeId);
    if (conflicts.length && !(p.force && settings.allowOverbooking)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: settings.allowOverbooking ? 'Horário ocupado. Confirme para encaixar mesmo assim.' : 'Este profissional já tem um compromisso neste horário.',
        canForce: settings.allowOverbooking,
        conflicts: conflicts.map((c) => ({ id: c.id, startsAt: c.start, endsAt: c.end })),
      });
    }
    if (!p.isBlock && !p.force) {
      const ok = await this.availability.isWithinHours(ctx.user.organizationId, p.unitId, p.professionalId, p.start, p.end);
      if (!ok) throw new ConflictException({ code: 'OUTSIDE_HOURS', message: 'Fora do horário de atendimento. Confirme para agendar como atendimento extraordinário.', canForce: true });
    }
  }

  // ───────────────────────── consultas ─────────────────────────

  async list(ctx: RequestContext, q: { from: string; to: string; professionalId?: string; unitId?: string }) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to.getTime() - from.getTime() > 62 * 86_400_000) throw new BadRequestException('Período máximo de 62 dias');
    const where: Prisma.AppointmentWhereInput = {
      organizationId: ctx.user.organizationId,
      startsAt: { lt: to },
      endsAt: { gt: from },
      status: { not: AppointmentStatus.RESCHEDULED },
    };
    if (q.professionalId) where.professionalId = q.professionalId;
    if (q.unitId) where.unitId = q.unitId;
    const rows = await this.prisma.appointment.findMany({ where, include, orderBy: { startsAt: 'asc' } });
    return rows.map((a) => this.present(a));
  }

  async get(ctx: RequestContext, id: string) {
    const a = await this.find(ctx, id);
    const history = await this.prisma.appointmentStatusHistory.findMany({ where: { appointmentId: id }, orderBy: { createdAt: 'asc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: history.map((h) => h.changedById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    return {
      ...this.present(a),
      history: history.map((h) => ({ ...h, fromLabel: h.fromStatus ? STATUS_LABELS[h.fromStatus] : null, toLabel: STATUS_LABELS[h.toStatus], by: users.find((u) => u.id === h.changedById)?.name ?? (h.channel === 'whatsapp' ? 'Paciente (WhatsApp)' : null) })),
    };
  }

  // ───────────────────────── criação ─────────────────────────

  private async resolveServiceAndPrice(ctx: RequestContext, serviceId?: string, duration?: number, price?: number) {
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: ctx.user.organizationId } });
    let service = null;
    if (serviceId) {
      service = await this.prisma.service.findFirst({ where: { id: serviceId, organizationId: ctx.user.organizationId } });
      if (!service) throw new BadRequestException('Serviço inválido');
    }
    return {
      service,
      duration: duration ?? service?.durationMinutes ?? settings.defaultSessionMinutes,
      price: price ?? service?.priceCents ?? settings.defaultSessionPriceCents,
    };
  }

  async create(ctx: RequestContext, dto: AppointmentDto) {
    const isBlock = dto.kind === 'BLOCK';
    if (!isBlock && !dto.patientId) throw new BadRequestException('Selecione o paciente');
    const unitId = await this.defaultUnit(ctx, dto.unitId);
    await this.assertProfessional(ctx, dto.professionalId);
    const patient = dto.patientId ? await this.assertPatient(ctx, dto.patientId) : null;
    const { service, duration, price } = await this.resolveServiceAndPrice(ctx, dto.serviceId, dto.durationMinutes, dto.priceCents);
    if (dto.packageId) {
      const ok = await this.prisma.package.count({ where: { id: dto.packageId, patientId: dto.patientId, status: 'ACTIVE' } });
      if (!ok) throw new BadRequestException('Pacote inválido ou encerrado');
    }
    const start = new Date(dto.startsAt);
    const end = new Date(start.getTime() + duration * 60_000);
    await this.check(ctx, { unitId, professionalId: dto.professionalId, start, end, force: dto.force, isBlock });

    const a = await this.prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          organizationId: ctx.user.organizationId,
          unitId,
          professionalId: dto.professionalId,
          patientId: patient?.id ?? null,
          serviceId: service?.id ?? null,
          packageId: dto.packageId ?? null,
          startsAt: start,
          endsAt: end,
          status: isBlock ? AppointmentStatus.BLOCKED : AppointmentStatus.SCHEDULED,
          priceCents: isBlock ? 0 : price,
          notes: dto.notes ?? null,
          createdById: ctx.user.id,
          statusHistory: { create: { toStatus: isBlock ? AppointmentStatus.BLOCKED : AppointmentStatus.SCHEDULED, changedById: ctx.user.id, channel: 'sistema' } },
        },
        include,
      });
      if (patient && service?.kind === 'EVALUATION') {
        await tx.lead.updateMany({ where: { patientId: patient.id, stage: { in: [LeadStage.NEW_CONTACT, LeadStage.FIRST_SERVICE, LeadStage.DATA_COLLECTED] } }, data: { stage: LeadStage.EVALUATION_SCHEDULED } });
      }
      await this.audit.record(
        ctx,
        {
          action: AuditAction.CREATE,
          entity: 'appointment',
          entityId: created.id,
          summary: isBlock
            ? `Horário bloqueado: ${localDateKey(start)} ${localTime(start)}–${localTime(end)}${dto.notes ? ` (${dto.notes})` : ''}`
            : `${patient!.name}: ${service?.name ?? 'atendimento'} agendado para ${localDateKey(start).split('-').reverse().join('/')} às ${localTime(start)}${dto.force ? ' (extraordinário)' : ''}`,
        },
        tx,
      );
      return created;
    });
    if (!isBlock) this.events.emit('appointment.created', { organizationId: ctx.user.organizationId, actorUserId: ctx.user.id, entityId: a.id });
    return this.present(a);
  }

  async move(ctx: RequestContext, id: string, dto: MoveAppointmentDto) {
    const a = await this.find(ctx, id);
    if (!EDITABLE.includes(a.status)) throw new BadRequestException(`Agendamento ${STATUS_LABELS[a.status].toLowerCase()} não pode ser alterado`);
    const professionalId = dto.professionalId ?? a.professionalId;
    if (dto.professionalId) await this.assertProfessional(ctx, dto.professionalId);
    let serviceId = a.serviceId;
    if (dto.serviceId) serviceId = (await this.resolveServiceAndPrice(ctx, dto.serviceId)).service!.id;
    const duration = dto.durationMinutes ?? Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
    const start = dto.startsAt ? new Date(dto.startsAt) : a.startsAt;
    const end = new Date(start.getTime() + duration * 60_000);
    const timeChanged = start.getTime() !== a.startsAt.getTime() || end.getTime() !== a.endsAt.getTime() || professionalId !== a.professionalId;
    if (timeChanged) await this.check(ctx, { unitId: a.unitId, professionalId, start, end, force: dto.force, excludeId: id, isBlock: a.status === 'BLOCKED' });
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.appointment.update({
        where: { id },
        data: {
          startsAt: start, endsAt: end, professionalId, serviceId,
          ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          // Mudou o horário: a confirmação e os lembretes precisam ser refeitos.
          ...(timeChanged ? { status: a.status === 'BLOCKED' ? 'BLOCKED' : AppointmentStatus.SCHEDULED, confirmedAt: null, reminder24hSentAt: null, reminder2hSentAt: null } : {}),
        },
        include,
      });
      await this.audit.record(
        ctx,
        {
          action: AuditAction.UPDATE,
          entity: 'appointment',
          entityId: id,
          summary: `${a.patient?.name ?? 'Bloqueio'}: agendamento ${timeChanged ? `movido para ${localDateKey(start).split('-').reverse().join('/')} às ${localTime(start)}` : 'atualizado'}`,
          changes: AuditService.diff({ startsAt: a.startsAt, endsAt: a.endsAt, professionalId: a.professionalId, serviceId: a.serviceId, priceCents: a.priceCents, notes: a.notes }, { startsAt: u.startsAt, endsAt: u.endsAt, professionalId: u.professionalId, serviceId: u.serviceId, priceCents: u.priceCents, notes: u.notes }),
        },
        tx,
      );
      return u;
    });
    return this.present(updated);
  }

  async setStatus(ctx: RequestContext, id: string, dto: StatusDto, channel = 'sistema') {
    const a = await this.find(ctx, id);
    if (a.status === 'BLOCKED') {
      if (dto.status !== 'CANCELLED') throw new BadRequestException('Bloqueios só podem ser removidos');
    } else if (['DONE', 'RESCHEDULED'].includes(a.status)) {
      throw new BadRequestException(`Agendamento ${STATUS_LABELS[a.status].toLowerCase()} não pode mudar de status`);
    }
    if (dto.status === 'NO_SHOW' && a.startsAt > new Date()) throw new BadRequestException('Só é possível marcar falta depois do horário agendado');
    if (a.status === dto.status) return this.present(a);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.appointment.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.status === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
          ...(dto.status === 'CANCELLED' ? { cancelReason: dto.reason ?? null } : {}),
        },
        include,
      });
      await tx.appointmentStatusHistory.create({ data: { appointmentId: id, fromStatus: a.status, toStatus: dto.status, changedById: ctx.user.id, channel: dto.channel ?? channel, reason: dto.reason ?? null } });
      // Cancelou/faltou: a cobrança ainda não paga daquele agendamento é cancelada.
      if (dto.status === 'CANCELLED') {
        await tx.payment.updateMany({ where: { appointmentId: id, status: 'PENDING', paidCents: 0 }, data: { status: 'CANCELLED' } });
      }
      await this.audit.record(
        ctx,
        { action: AuditAction.UPDATE, entity: 'appointment', entityId: id, summary: `${a.patient?.name ?? 'Bloqueio'}: ${STATUS_LABELS[a.status]} → ${STATUS_LABELS[dto.status]}${dto.reason ? ` (${dto.reason})` : ''}`, changes: { status: { from: a.status, to: dto.status } } },
        tx,
      );
      return u;
    });
    const payload = { organizationId: ctx.user.organizationId, actorUserId: ctx.user.id, entityId: id, data: { from: a.status, to: dto.status } };
    this.events.emit('appointment.status_changed', payload);
    if (dto.status === 'NO_SHOW') this.events.emit('appointment.no_show', payload);
    if (dto.status === 'CANCELLED') this.events.emit('appointment.cancelled', payload);
    return this.present(updated);
  }

  /** Reagendar: cria o novo horário e mantém o original com status "Reagendado" (histórico preservado). */
  async reschedule(ctx: RequestContext, id: string, dto: RescheduleDto) {
    const a = await this.find(ctx, id);
    if (!['SCHEDULED', 'CONFIRMED', 'NO_SHOW', 'CANCELLED'].includes(a.status)) throw new BadRequestException('Este agendamento não pode ser reagendado');
    if (!a.patientId) throw new BadRequestException('Bloqueios não são reagendados');
    const professionalId = dto.professionalId ?? a.professionalId;
    const duration = dto.durationMinutes ?? Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
    const start = new Date(dto.startsAt);
    const end = new Date(start.getTime() + duration * 60_000);
    await this.check(ctx, { unitId: a.unitId, professionalId, start, end, force: dto.force, excludeId: id });
    const created = await this.prisma.$transaction(async (tx) => {
      const n = await tx.appointment.create({
        data: {
          organizationId: a.organizationId, unitId: a.unitId, professionalId, patientId: a.patientId, serviceId: a.serviceId, packageId: a.packageId,
          seriesId: a.seriesId, startsAt: start, endsAt: end, priceCents: a.priceCents, notes: a.notes, rescheduledFromId: a.id, createdById: ctx.user.id,
          statusHistory: { create: { toStatus: AppointmentStatus.SCHEDULED, changedById: ctx.user.id, channel: 'reagendamento', reason: dto.reason ?? null } },
        },
        include,
      });
      await tx.appointment.update({ where: { id }, data: { status: AppointmentStatus.RESCHEDULED } });
      await tx.appointmentStatusHistory.create({ data: { appointmentId: id, fromStatus: a.status, toStatus: AppointmentStatus.RESCHEDULED, changedById: ctx.user.id, reason: dto.reason ?? null } });
      await tx.payment.updateMany({ where: { appointmentId: id, status: 'PENDING', paidCents: 0 }, data: { appointmentId: n.id } });
      await this.audit.record(
        ctx,
        { action: AuditAction.UPDATE, entity: 'appointment', entityId: id, summary: `${a.patient!.name}: reagendado de ${localDateKey(a.startsAt).split('-').reverse().join('/')} ${localTime(a.startsAt)} para ${localDateKey(start).split('-').reverse().join('/')} ${localTime(start)}`, metadata: { newAppointmentId: n.id } },
        tx,
      );
      return n;
    });
    return this.present(created);
  }

  // ───────────────────────── recorrência ─────────────────────────

  /** "2 vezes por semana durante 3 meses, terças e quintas às 15h" → gera todas as sessões. */
  async recurring(ctx: RequestContext, dto: RecurringDto) {
    if (!dto.endDate && !dto.occurrences && !dto.packageId) throw new BadRequestException('Informe a data final, o número de sessões ou o pacote');
    const unitId = await this.defaultUnit(ctx, dto.unitId);
    await this.assertProfessional(ctx, dto.professionalId);
    const patient = await this.assertPatient(ctx, dto.patientId);
    const { service, duration, price } = await this.resolveServiceAndPrice(ctx, dto.serviceId, dto.durationMinutes, dto.priceCents);
    const weekdays = [...new Set(dto.weekdays)].sort();
    let max = dto.occurrences ?? 200;
    if (dto.packageId) {
      const pkg = await this.prisma.package.findFirst({ where: { id: dto.packageId, patientId: dto.patientId, status: 'ACTIVE' }, include: { _count: { select: { usages: { where: { reversedAt: null } } } } } });
      if (!pkg) throw new BadRequestException('Pacote inválido ou encerrado');
      if (!dto.occurrences) max = Math.max(0, pkg.contractedSessions - pkg._count.usages);
    }
    const endKey = dto.endDate?.slice(0, 10) ?? '2999-12-31';
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: ctx.user.organizationId } });

    const planned: { startsAt: Date; endsAt: Date; problem: string | null }[] = [];
    let day = new Date(`${dto.startDate.slice(0, 10)}T12:00:00Z`);
    let guard = 0;
    while (planned.length < max && day.toISOString().slice(0, 10) <= endKey && guard++ < 800) {
      if (weekdays.includes(day.getUTCDay())) {
        const key = day.toISOString().slice(0, 10);
        const start = localToUtc(key, dto.time);
        const end = new Date(start.getTime() + duration * 60_000);
        let problem: string | null = null;
        if (start < new Date()) problem = 'Horário no passado';
        else {
          const busy = await this.availability.busy(ctx.user.organizationId, dto.professionalId, start, end);
          if (busy.length && !(dto.force && settings.allowOverbooking)) problem = 'Horário ocupado';
          else if (!dto.force && !(await this.availability.isWithinHours(ctx.user.organizationId, unitId, dto.professionalId, start, end))) problem = 'Fora do horário de atendimento';
        }
        planned.push({ startsAt: start, endsAt: end, problem });
      }
      day = addDays(day, 1);
    }
    if (!planned.length) throw new BadRequestException('Nenhuma data encontrada no período para os dias escolhidos');
    const ok = planned.filter((p) => !p.problem);
    const conflicts = planned.filter((p) => p.problem);
    const preview = { total: planned.length, ok: ok.length, conflicts: conflicts.map((c) => ({ startsAt: c.startsAt, problem: c.problem })), dates: planned };
    if (dto.dryRun) return { ...preview, created: 0 };
    if (conflicts.length && !dto.skipConflicts) throw new ConflictException({ code: 'RECURRENCE_CONFLICTS', message: `${conflicts.length} data(s) com conflito`, ...preview });
    if (!ok.length) throw new BadRequestException('Nenhuma data disponível para agendar');

    const series = await this.prisma.$transaction(async (tx) => {
      const s = await tx.recurrenceSeries.create({
        data: {
          organizationId: ctx.user.organizationId, patientId: patient.id, professionalId: dto.professionalId, serviceId: service?.id ?? null, packageId: dto.packageId ?? null,
          weekdays, startTime: dto.time, durationMinutes: duration, startDate: new Date(`${dto.startDate.slice(0, 10)}T00:00:00Z`),
          endDate: dto.endDate ? new Date(`${dto.endDate.slice(0, 10)}T00:00:00Z`) : null, occurrences: ok.length, createdById: ctx.user.id,
        },
      });
      for (const p of ok) {
        await tx.appointment.create({
          data: {
            organizationId: ctx.user.organizationId, unitId, professionalId: dto.professionalId, patientId: patient.id, serviceId: service?.id ?? null,
            packageId: dto.packageId ?? null, seriesId: s.id, startsAt: p.startsAt, endsAt: p.endsAt, priceCents: price, createdById: ctx.user.id,
            statusHistory: { create: { toStatus: AppointmentStatus.SCHEDULED, changedById: ctx.user.id, channel: 'recorrência' } },
          },
        });
      }
      const names = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
      await this.audit.record(
        ctx,
        { action: AuditAction.CREATE, entity: 'recurrence', entityId: s.id, summary: `${patient.name}: ${ok.length} sessões recorrentes (${weekdays.map((w) => names[w]).join(', ')} às ${dto.time})${conflicts.length ? `; ${conflicts.length} data(s) ignorada(s) por conflito` : ''}` },
        tx,
      );
      return s;
    });
    return { ...preview, created: ok.length, seriesId: series.id };
  }

  async cancelSeries(ctx: RequestContext, seriesId: string, fromDate?: string, reason?: string) {
    const s = await this.prisma.recurrenceSeries.findFirst({ where: { id: seriesId, organizationId: ctx.user.organizationId }, include: { patient: { select: { name: true } } } });
    if (!s) notFound('Série');
    const from = fromDate ? new Date(fromDate) : new Date();
    const targets = await this.prisma.appointment.findMany({ where: { seriesId, startsAt: { gte: from }, status: { in: ['SCHEDULED', 'CONFIRMED'] } }, select: { id: true, status: true } });
    await this.prisma.$transaction(async (tx) => {
      for (const t of targets) {
        await tx.appointment.update({ where: { id: t.id }, data: { status: AppointmentStatus.CANCELLED, cancelReason: reason ?? 'Série cancelada' } });
        await tx.appointmentStatusHistory.create({ data: { appointmentId: t.id, fromStatus: t.status, toStatus: AppointmentStatus.CANCELLED, changedById: ctx.user.id, reason: reason ?? 'Série cancelada' } });
      }
      await tx.recurrenceSeries.update({ where: { id: seriesId }, data: { isActive: false } });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'recurrence', entityId: seriesId, summary: `${s.patient.name}: ${targets.length} sessão(ões) futura(s) da série cancelada(s)` }, tx);
    });
    return { cancelled: targets.length };
  }

  // ───────────────────────── agenda do paciente ─────────────────────────

  async forPatient(ctx: RequestContext, patientId: string) {
    const p = await this.prisma.patient.findFirst({ where: { AND: [patientScope(ctx), { id: patientId }] }, select: { id: true } });
    if (!p) notFound('Paciente');
    const rows = await this.prisma.appointment.findMany({ where: { patientId, organizationId: ctx.user.organizationId }, include, orderBy: { startsAt: 'desc' }, take: 300 });
    const now = new Date();
    const count = (fn: (a: Appt) => boolean) => rows.filter(fn).length;
    const [pkg, plan, sessionsDone] = await Promise.all([
      this.prisma.package.findFirst({ where: { patientId, status: 'ACTIVE' }, include: { _count: { select: { usages: { where: { reversedAt: null } } } } } }),
      this.prisma.treatmentPlan.findFirst({ where: { patientId, status: 'ACTIVE' }, select: { plannedSessions: true } }),
      this.prisma.treatmentSession.count({ where: { patientId, evolution: { deletedAt: null } } }),
    ]);
    const future = count((a) => a.startsAt >= now && ['SCHEDULED', 'CONFIRMED'].includes(a.status));
    return {
      summary: {
        done: count((a) => a.status === 'DONE'),
        future,
        cancelled: count((a) => a.status === 'CANCELLED'),
        noShow: count((a) => a.status === 'NO_SHOW'),
        rescheduled: count((a) => a.status === 'RESCHEDULED'),
        // Restantes: saldo do pacote; sem pacote, o que falta do plano de tratamento.
        remaining: pkg ? pkg.contractedSessions - pkg._count.usages : plan?.plannedSessions ? Math.max(0, plan.plannedSessions - sessionsDone) : null,
        remainingSource: pkg ? 'package' : plan?.plannedSessions ? 'plan' : null,
      },
      series: await this.prisma.recurrenceSeries.findMany({ where: { patientId, isActive: true }, select: { id: true, weekdays: true, startTime: true, startDate: true, endDate: true, occurrences: true } }).then((s) => s.map((x) => ({ ...x, startDate: dateOnly(x.startDate), endDate: dateOnly(x.endDate) }))),
      appointments: rows.map((a) => this.present(a)),
    };
  }

  /** Agendamentos de hoje do profissional logado (ou de todos, para quem gerencia a agenda). */
  async today(ctx: RequestContext) {
    const key = localDateKey(new Date());
    const from = localToUtc(key, '00:00');
    const to = addDays(from, 1);
    const onlyMine = !can(ctx, 'patients.read_all');
    const rows = await this.prisma.appointment.findMany({
      where: { organizationId: ctx.user.organizationId, startsAt: { gte: from, lt: to }, status: { notIn: ['RESCHEDULED', 'BLOCKED'] }, ...(onlyMine ? { professionalId: ctx.user.id } : {}) },
      include,
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((a) => this.present(a));
  }

  assertCanManage(ctx: RequestContext) {
    if (!can(ctx, 'schedule.write')) throw new ForbiddenException();
  }
}
