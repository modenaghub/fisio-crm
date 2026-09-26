import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { AppointmentStatus, PatientStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { addDays, can, dateOnly, localDateKey, localToUtc } from '../../common/helpers';
import { AvailabilityService } from '../schedule/availability.service';
import { ScheduleModule } from '../schedule/schedule.module';
import { FinanceModule } from '../finance/finance.module';
import { FinanceService } from '../finance/finance.service';

const ACTIVE_STAGES: PatientStage[] = ['TREATMENT_STARTED', 'ACTIVE', 'IN_TREATMENT'];
const BOOKED: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'DONE'];

function monthStartKey(key: string, delta = 0) {
  const d = new Date(`${key.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * "Como está minha clínica hoje?" — indicadores de hoje, semana e mês, projeção, metas e pendências.
 * Quem não vê todos os pacientes (fisioterapeuta) recebe os números da própria agenda;
 * valores financeiros só aparecem com a permissão de relatórios financeiros.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly availability: AvailabilityService,
  ) {}

  private async range(ctx: RequestContext, from: Date, to: Date, pros: string[], mine: boolean) {
    const org = ctx.user.organizationId;
    const apptWhere: Prisma.AppointmentWhereInput = { organizationId: org, startsAt: { gte: from, lt: to }, patientId: { not: null }, ...(mine ? { professionalId: ctx.user.id } : {}) };
    const [byStatus, patients, sessions, rescheduled] = await Promise.all([
      this.prisma.appointment.groupBy({ by: ['status'], where: apptWhere, _count: true }),
      this.prisma.appointment.findMany({ where: { ...apptWhere, status: { in: BOOKED } }, distinct: ['patientId'], select: { patientId: true } }),
      this.prisma.treatmentSession.count({ where: { organizationId: org, performedAt: { gte: from, lt: to }, evolution: { deletedAt: null }, ...(mine ? { professionalId: ctx.user.id } : {}) } }),
      this.prisma.appointmentStatusHistory.count({ where: { toStatus: 'RESCHEDULED', createdAt: { gte: from, lt: to }, appointment: { organizationId: org, ...(mine ? { professionalId: ctx.user.id } : {}) } } }),
    ]);
    const n = (s: AppointmentStatus) => byStatus.find((b) => b.status === s)?._count ?? 0;
    const unit = await this.prisma.unit.findFirst({ where: { organizationId: org, isActive: true }, orderBy: { createdAt: 'asc' } });
    const occ = unit && pros.length ? await this.availability.occupancy(org, unit.id, pros, from, to) : { availableMin: 0, bookedMin: 0, rate: 0 };
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: org } });
    return {
      appointments: n('SCHEDULED') + n('CONFIRMED') + n('IN_PROGRESS') + n('DONE') + n('CANCELLED') + n('NO_SHOW'),
      scheduled: n('SCHEDULED'),
      confirmed: n('CONFIRMED'),
      done: n('DONE'),
      cancelled: n('CANCELLED'),
      noShows: n('NO_SHOW'),
      rescheduled,
      patients: patients.length,
      sessions,
      occupancyRate: occ.rate,
      bookedSlots: Math.round(occ.bookedMin / settings.defaultSessionMinutes),
      freeSlots: Math.max(0, Math.floor((occ.availableMin - occ.bookedMin) / settings.defaultSessionMinutes)),
    };
  }

  async get(ctx: RequestContext) {
    const org = ctx.user.organizationId;
    const mine = !can(ctx, 'patients.read_all');
    const money = can(ctx, 'finance.reports');
    const today = localDateKey(new Date());
    const dayStart = localToUtc(today, '00:00');
    const dayEnd = addDays(dayStart, 1);
    const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
    const weekStartKey = localDateKey(addDays(localToUtc(today, '12:00'), wd === 0 ? -6 : 1 - wd));
    const weekStart = localToUtc(weekStartKey, '00:00');
    const weekEnd = addDays(weekStart, 7);
    const mStartKey = monthStartKey(today);
    const mNextKey = monthStartKey(today, 1);
    const mEndKey = localDateKey(addDays(localToUtc(mNextKey, '12:00'), -1));
    const monthStart = localToUtc(mStartKey, '00:00');
    const monthEnd = localToUtc(mNextKey, '00:00');
    const prevMonthStart = localToUtc(monthStartKey(today, -1), '00:00');

    const pros = mine
      ? [ctx.user.id]
      : (await this.prisma.user.findMany({ where: { organizationId: org, isActive: true, professional: { isNot: null } }, select: { id: true } })).map((u) => u.id);

    const [todayR, weekR, monthR] = await Promise.all([
      this.range(ctx, dayStart, dayEnd, pros, mine),
      this.range(ctx, weekStart, weekEnd, pros, mine),
      this.range(ctx, monthStart, monthEnd, pros, mine),
    ]);

    // Pacientes: ativos, inativos, novos, recorrentes e taxa de retorno.
    const patientBase: Prisma.PatientWhereInput = { organizationId: org, deletedAt: null, ...(mine ? { responsibleId: ctx.user.id } : {}) };
    const [activePatients, inactivePatients, newWeek, newMonth, recurringWeek, prevMonthPatients, thisMonthPatients] = await Promise.all([
      this.prisma.patient.count({ where: { ...patientBase, crmStage: { in: ACTIVE_STAGES } } }),
      this.prisma.patient.count({ where: { ...patientBase, crmStage: 'INACTIVE' } }),
      this.prisma.patient.count({ where: { ...patientBase, createdAt: { gte: weekStart, lt: weekEnd } } }),
      this.prisma.patient.count({ where: { ...patientBase, createdAt: { gte: monthStart, lt: monthEnd } } }),
      // Recorrentes: atendidos nesta semana que já tinham sessão antes dela.
      this.prisma.patient.count({ where: { ...patientBase, treatmentSessions: { some: { performedAt: { gte: weekStart, lt: weekEnd } } }, AND: [{ treatmentSessions: { some: { performedAt: { lt: weekStart } } } }] } }),
      this.prisma.treatmentSession.findMany({ where: { organizationId: org, performedAt: { gte: prevMonthStart, lt: monthStart }, ...(mine ? { professionalId: ctx.user.id } : {}) }, distinct: ['patientId'], select: { patientId: true } }),
      this.prisma.treatmentSession.findMany({ where: { organizationId: org, performedAt: { gte: monthStart, lt: monthEnd }, ...(mine ? { professionalId: ctx.user.id } : {}) }, distinct: ['patientId'], select: { patientId: true } }),
    ]);
    const thisSet = new Set(thisMonthPatients.map((p) => p.patientId));
    const returnRate = prevMonthPatients.length ? prevMonthPatients.filter((p) => thisSet.has(p.patientId)).length / prevMonthPatients.length : null;

    // Financeiro (somente com permissão).
    let financeBlock = null;
    if (money) {
      const [dayW, weekW, monthW, m3, m6, monthSummary, weekSummary, daySummary] = await Promise.all([
        this.finance.projectWindow(ctx, today, today),
        this.finance.projectWindow(ctx, weekStartKey, localDateKey(addDays(weekEnd, -1))),
        this.finance.projectWindow(ctx, mStartKey, mEndKey),
        this.finance.projectWindow(ctx, today, localDateKey(addDays(localToUtc(monthStartKey(today, 3), '12:00'), -1))),
        this.finance.projectWindow(ctx, today, localDateKey(addDays(localToUtc(monthStartKey(today, 6), '12:00'), -1))),
        this.finance.summary(ctx, mStartKey, mEndKey),
        this.finance.summary(ctx, weekStartKey, localDateKey(addDays(weekEnd, -1))),
        this.finance.summary(ctx, today, today),
      ]);
      financeBlock = {
        today: { expectedCents: dayW.expectedCents, receivedCents: daySummary.receivedCents },
        week: { expectedCents: weekW.expectedCents, receivedCents: weekSummary.receivedCents },
        month: {
          billedCents: monthSummary.billedCents,
          receivedCents: monthSummary.receivedCents,
          expectedCents: monthW.expectedCents,
          averageTicketCents: monthSummary.averageTicketCents,
          overdueCents: monthSummary.overdueCents,
        },
        projection: { monthCents: monthW.expectedCents + monthSummary.receivedCents, next3Cents: m3.expectedCents, next6Cents: m6.expectedCents },
      };
    }

    // Pendências.
    const now = new Date();
    const staleLead = addDays(now, -2);
    const [unconfirmedToday, overdue, packagesEnding, openTasks, leadsWaiting, noReturnCandidates, openConversations, unread] = await Promise.all([
      this.prisma.appointment.count({ where: { organizationId: org, startsAt: { gte: now, lt: dayEnd }, status: 'SCHEDULED', patientId: { not: null }, ...(mine ? { professionalId: ctx.user.id } : {}) } }),
      can(ctx, 'finance.read')
        ? this.prisma.payment.aggregate({ where: { organizationId: org, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, dueDate: { lt: new Date(`${today}T00:00:00Z`) } }, _count: true, _sum: { amountCents: true, paidCents: true } })
        : null,
      this.prisma.package.findMany({ where: { organizationId: org, status: 'ACTIVE', patient: { deletedAt: null, ...(mine ? { responsibleId: ctx.user.id } : {}) } }, select: { id: true, name: true, contractedSessions: true, patient: { select: { id: true, name: true } }, _count: { select: { usages: { where: { reversedAt: null } } } } } }),
      this.prisma.task.count({ where: { organizationId: org, status: { in: ['OPEN', 'IN_PROGRESS'] }, OR: [{ assigneeId: ctx.user.id }, { assigneeId: null }] } }),
      can(ctx, 'leads.read') ? this.prisma.lead.count({ where: { organizationId: org, deletedAt: null, stage: { in: ['NEW_CONTACT', 'FIRST_SERVICE'] }, OR: [{ lastContactAt: { lt: staleLead } }, { lastContactAt: null, firstContactAt: { lt: staleLead } }] } }) : 0,
      this.prisma.patient.findMany({
        where: { ...patientBase, crmStage: { in: ACTIVE_STAGES }, appointments: { none: { startsAt: { gte: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } } }, treatmentSessions: { some: {} } },
        select: { id: true, name: true, treatmentSessions: { orderBy: { performedAt: 'desc' }, take: 1, select: { performedAt: true } } },
        take: 200,
      }),
      can(ctx, 'messages.read') ? this.prisma.conversation.count({ where: { organizationId: org, status: { in: ['OPEN', 'BOT'] } } }) : 0,
      this.prisma.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
    ]);
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: org } });
    const noReturn = noReturnCandidates
      .filter((p) => p.treatmentSessions[0] && p.treatmentSessions[0].performedAt < addDays(now, -settings.noShowFollowUpDays))
      .map((p) => ({ id: p.id, name: p.name, lastSessionAt: p.treatmentSessions[0].performedAt }))
      .sort((a, b) => a.lastSessionAt.getTime() - b.lastSessionAt.getTime());
    const ending = packagesEnding.map((p) => ({ id: p.id, name: p.name, patient: p.patient, remaining: p.contractedSessions - p._count.usages })).filter((p) => p.remaining <= 2).sort((a, b) => a.remaining - b.remaining);
    const overdueCents = overdue ? (overdue._sum.amountCents ?? 0) - (overdue._sum.paidCents ?? 0) : null;

    const pending = [
      unconfirmedToday && { key: 'unconfirmed', label: `${unconfirmedToday} consulta(s) de hoje sem confirmação`, link: '/agenda', severity: 'warning' },
      overdue && overdue._count && { key: 'overdue', label: `${overdue._count} pagamento(s) em atraso`, link: '/financeiro?aba=receber', severity: 'critical', amountCents: overdueCents },
      ending.length && { key: 'packages', label: `${ending.length} pacote(s) perto do fim`, link: '/financeiro?aba=pacotes', severity: 'warning' },
      noReturn.length && { key: 'noReturn', label: `${noReturn.length} paciente(s) sem retorno há mais de ${settings.noShowFollowUpDays} dias`, link: '/pacientes', severity: 'warning' },
      leadsWaiting && { key: 'leads', label: `${leadsWaiting} lead(s) aguardando contato há mais de 2 dias`, link: '/crm', severity: 'warning' },
      openTasks && { key: 'tasks', label: `${openTasks} tarefa(s) em aberto`, link: '/tarefas', severity: 'info' },
    ].filter(Boolean);

    // Sessões por semana (8 semanas) para o gráfico.
    const trend = [];
    for (let i = 7; i >= 0; i--) {
      const s = addDays(weekStart, -7 * i);
      const e = addDays(s, 7);
      const [sessions, cancelled] = await Promise.all([
        this.prisma.treatmentSession.count({ where: { organizationId: org, performedAt: { gte: s, lt: e }, evolution: { deletedAt: null }, ...(mine ? { professionalId: ctx.user.id } : {}) } }),
        this.prisma.appointment.count({ where: { organizationId: org, startsAt: { gte: s, lt: e }, status: { in: ['CANCELLED', 'NO_SHOW'] }, ...(mine ? { professionalId: ctx.user.id } : {}) } }),
      ]);
      trend.push({ weekStart: localDateKey(s), sessions, lost: cancelled });
    }

    return {
      scope: mine ? 'mine' : 'clinic',
      canSeeMoney: money,
      today: { date: today, ...todayR },
      week: { from: weekStartKey, ...weekR, newPatients: newWeek, recurringPatients: recurringWeek },
      month: { from: mStartKey, to: mEndKey, ...monthR, newPatients: newMonth, activePatients, inactivePatients, returnRate },
      finance: financeBlock,
      pending,
      noReturn: noReturn.slice(0, 10).map((p) => ({ ...p, lastSessionAt: dateOnly(p.lastSessionAt) })),
      packagesEnding: ending.slice(0, 10),
      counts: { pending: pending.length, messages: openConversations, alerts: unread, tasks: openTasks },
      trend,
    };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @RequirePermissions('dashboard.view')
  @Get()
  get(@Ctx() ctx: RequestContext) {
    return this.dashboard.get(ctx);
  }
}

@Module({ imports: [ScheduleModule, FinanceModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
