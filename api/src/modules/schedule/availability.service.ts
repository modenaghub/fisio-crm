import { Injectable } from '@nestjs/common';
import { AppointmentStatus, AvailabilityExceptionKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { addDays, localToUtc, localWeekday, TZ_OFFSET_MIN } from '../../common/helpers';

export interface Interval { start: Date; end: Date }

const BUSY: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'BLOCKED'];
export const ACTIVE_STATUSES = BUSY;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Subtrai um conjunto de intervalos de outro. */
export function subtract(base: Interval[], remove: Interval[]): Interval[] {
  let out = base;
  for (const r of remove) {
    const next: Interval[] = [];
    for (const b of out) {
      if (r.end <= b.start || r.start >= b.end) { next.push(b); continue; }
      if (r.start > b.start) next.push({ start: b.start, end: r.start });
      if (r.end < b.end) next.push({ start: r.end, end: b.end });
    }
    out = next;
  }
  return out;
}

export function merge(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = new Date(Math.max(last.end.getTime(), i.end.getTime()));
    else out.push({ ...i });
  }
  return out;
}

const minutes = (list: Interval[]) => list.reduce((n, i) => n + (i.end.getTime() - i.start.getTime()) / 60_000, 0);

/**
 * Disponibilidade = horário semanal (do profissional, se ele tiver regras próprias; senão, da unidade)
 * − feriados − folgas/férias/bloqueios/intervalos + horários extras. "Horário especial" substitui o dia.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Datas locais (YYYY-MM-DD) entre dois instantes. */
  private localDates(from: Date, to: Date) {
    const out: string[] = [];
    let d = new Date(from.getTime() + TZ_OFFSET_MIN * 60_000);
    d.setUTCHours(0, 0, 0, 0);
    const endLocal = new Date(to.getTime() + TZ_OFFSET_MIN * 60_000);
    while (d <= endLocal) {
      out.push(d.toISOString().slice(0, 10));
      d = addDays(d, 1);
    }
    return out;
  }

  async workingIntervals(orgId: string, unitId: string, professionalId: string | null, from: Date, to: Date): Promise<Interval[]> {
    const [profRules, unitRules, exceptions, holidays] = await Promise.all([
      professionalId ? this.prisma.availabilityRule.findMany({ where: { organizationId: orgId, unitId, professionalId } }) : [],
      this.prisma.availabilityRule.findMany({ where: { organizationId: orgId, unitId, professionalId: null } }),
      this.prisma.availabilityException.findMany({
        where: {
          organizationId: orgId,
          unitId,
          OR: [{ professionalId: null }, ...(professionalId ? [{ professionalId }] : [])],
          startsAt: { lt: to },
          endsAt: { gt: from },
        },
      }),
      this.prisma.holiday.findMany({ where: { organizationId: orgId } }),
    ]);
    const rules = profRules.length ? profRules : unitRules;
    const holidayKeys = new Set(holidays.map((h) => (h.isRecurring ? h.date.toISOString().slice(5, 10) : h.date.toISOString().slice(0, 10))));
    const special = exceptions.filter((e) => e.kind === AvailabilityExceptionKind.SPECIAL_HOURS);
    let intervals: Interval[] = [];
    for (const date of this.localDates(from, to)) {
      if (holidayKeys.has(date) || holidayKeys.has(date.slice(5))) continue;
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const dayStart = localToUtc(date, '00:00');
      const dayEnd = addDays(dayStart, 1);
      const specialToday = special.filter((s) => s.startsAt < dayEnd && s.endsAt > dayStart);
      if (specialToday.length) {
        intervals.push(...specialToday.map((s) => ({ start: s.startsAt, end: s.endsAt })));
        continue;
      }
      for (const r of rules.filter((x) => x.weekday === weekday)) {
        intervals.push({ start: localToUtc(date, r.startTime), end: localToUtc(date, r.endTime) });
      }
    }
    const removing = exceptions.filter((e) => (['DAY_OFF', 'VACATION', 'BLOCK', 'BREAK'] as string[]).includes(e.kind)).map((e) => ({ start: e.startsAt, end: e.endsAt }));
    intervals = subtract(merge(intervals), removing);
    intervals.push(...exceptions.filter((e) => e.kind === 'EXTRA_HOURS').map((e) => ({ start: e.startsAt, end: e.endsAt })));
    return merge(intervals).map((i) => ({ start: new Date(Math.max(i.start.getTime(), from.getTime())), end: new Date(Math.min(i.end.getTime(), to.getTime())) })).filter((i) => i.end > i.start);
  }

  async busy(orgId: string, professionalId: string, from: Date, to: Date, excludeId?: string): Promise<(Interval & { id: string })[]> {
    const rows = await this.prisma.appointment.findMany({
      where: { organizationId: orgId, professionalId, status: { in: BUSY }, startsAt: { lt: to }, endsAt: { gt: from }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true, startsAt: true, endsAt: true },
    });
    return rows.map((r) => ({ id: r.id, start: r.startsAt, end: r.endsAt }));
  }

  /** O intervalo está inteiramente dentro do horário de atendimento? */
  async isWithinHours(orgId: string, unitId: string, professionalId: string, start: Date, end: Date) {
    const work = await this.workingIntervals(orgId, unitId, professionalId, addDays(start, -1), addDays(end, 1));
    return work.some((w) => w.start <= start && w.end >= end);
  }

  /** Horários livres de um dia, em blocos da duração pedida. */
  async freeSlots(orgId: string, unitId: string, professionalId: string, date: string, durationMin: number, stepMin = 30) {
    const from = localToUtc(date, '00:00');
    const to = addDays(from, 1);
    const free = subtract(await this.workingIntervals(orgId, unitId, professionalId, from, to), await this.busy(orgId, professionalId, from, to));
    const slots: Date[] = [];
    const now = Date.now();
    for (const f of free) {
      for (let t = f.start.getTime(); t + durationMin * 60_000 <= f.end.getTime(); t += stepMin * 60_000) {
        if (t >= now) slots.push(new Date(t));
      }
    }
    return slots;
  }

  /** Ocupação: minutos agendados ÷ minutos disponíveis, por profissional. */
  async occupancy(orgId: string, unitId: string, professionalIds: string[], from: Date, to: Date) {
    let available = 0;
    let booked = 0;
    const per: { professionalId: string; availableMin: number; bookedMin: number; rate: number }[] = [];
    for (const pid of professionalIds) {
      const work = await this.workingIntervals(orgId, unitId, pid, from, to);
      const rows = await this.prisma.appointment.findMany({
        where: { organizationId: orgId, professionalId: pid, status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'DONE'] }, startsAt: { lt: to }, endsAt: { gt: from } },
        select: { startsAt: true, endsAt: true },
      });
      const a = minutes(work);
      // Conta só o que cai dentro do horário de atendimento (encaixes fora do horário não inflam a taxa).
      const inside = rows.reduce((n, r) => n + minutes(work.map((w) => ({ start: new Date(Math.max(w.start.getTime(), r.startsAt.getTime())), end: new Date(Math.min(w.end.getTime(), r.endsAt.getTime())) })).filter((i) => i.end > i.start)), 0);
      available += a;
      booked += inside;
      per.push({ professionalId: pid, availableMin: Math.round(a), bookedMin: Math.round(inside), rate: a ? inside / a : 0 });
    }
    return { availableMin: Math.round(available), bookedMin: Math.round(booked), rate: available ? booked / available : 0, perProfessional: per };
  }

  static localWeekday = localWeekday;
  static toMin = toMin;
}
