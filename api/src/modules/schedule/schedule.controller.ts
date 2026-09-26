import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';
import { addDays, notFound } from '../../common/helpers';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from './availability.service';
import { ScheduleService } from './schedule.service';
import {
  AppointmentDto,
  ExceptionDto,
  HolidayDto,
  MoveAppointmentDto,
  NationalHolidaysDto,
  ProfessionalHoursDto,
  RangeQuery,
  RecurringDto,
  RescheduleDto,
  SlotsQuery,
  StatusDto,
} from './schedule.dto';

class CancelSeriesDto {
  @IsOptional() @IsDateString() fromDate?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** Páscoa (algoritmo de Meeus) para calcular a Sexta-feira Santa. */
function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly schedule: ScheduleService) {}

  @RequirePermissions('schedule.read')
  @Get()
  list(@Ctx() ctx: RequestContext, @Query() q: RangeQuery) {
    return this.schedule.list(ctx, q);
  }

  @RequirePermissions('schedule.read')
  @Get('today')
  today(@Ctx() ctx: RequestContext) {
    return this.schedule.today(ctx);
  }

  @RequirePermissions('schedule.read')
  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.get(ctx, id);
  }

  @RequirePermissions('schedule.write')
  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: AppointmentDto) {
    if (dto.kind === 'BLOCK' && !ctx.user.permissions.includes('schedule.availability') && dto.professionalId !== ctx.user.id) {
      throw new BadRequestException('Você só pode bloquear a sua própria agenda');
    }
    return this.schedule.create(ctx, dto);
  }

  @RequirePermissions('schedule.write')
  @Post('recurring')
  recurring(@Ctx() ctx: RequestContext, @Body() dto: RecurringDto) {
    return this.schedule.recurring(ctx, dto);
  }

  @RequirePermissions('schedule.write')
  @Patch(':id')
  move(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveAppointmentDto) {
    return this.schedule.move(ctx, id, dto);
  }

  @RequirePermissions('schedule.write')
  @HttpCode(200)
  @Post(':id/status')
  status(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.schedule.setStatus(ctx, id, dto);
  }

  @RequirePermissions('schedule.write')
  @Post(':id/reschedule')
  reschedule(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDto) {
    return this.schedule.reschedule(ctx, id, dto);
  }
}

@Controller()
export class ScheduleController {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly availability: AvailabilityService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('schedule.write')
  @HttpCode(200)
  @Post('recurrence/:id/cancel')
  cancelSeries(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelSeriesDto) {
    return this.schedule.cancelSeries(ctx, id, dto.fromDate, dto.reason);
  }

  @RequirePermissions('schedule.read')
  @Get('patients/:id/appointments')
  forPatient(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.forPatient(ctx, id);
  }

  @RequirePermissions('schedule.read')
  @Get('schedule/slots')
  async slots(@Ctx() ctx: RequestContext, @Query() q: SlotsQuery) {
    const unitId = await this.schedule.defaultUnit(ctx, q.unitId);
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: ctx.user.organizationId } });
    return this.availability.freeSlots(ctx.user.organizationId, unitId, q.professionalId, q.date, q.durationMinutes ?? settings.defaultSessionMinutes);
  }

  /** Horário de atendimento no período (para sombrear a grade da agenda). */
  @RequirePermissions('schedule.read')
  @Get('schedule/working')
  async working(@Ctx() ctx: RequestContext, @Query() q: RangeQuery) {
    const unitId = await this.schedule.defaultUnit(ctx, q.unitId);
    return this.availability.workingIntervals(ctx.user.organizationId, unitId, q.professionalId ?? null, new Date(q.from), new Date(q.to));
  }

  @RequirePermissions('schedule.read')
  @Get('schedule/occupancy')
  async occupancy(@Ctx() ctx: RequestContext, @Query() q: RangeQuery) {
    const unitId = await this.schedule.defaultUnit(ctx, q.unitId);
    const pros = q.professionalId
      ? [q.professionalId]
      : (await this.prisma.user.findMany({ where: { organizationId: ctx.user.organizationId, isActive: true, professional: { isNot: null } }, select: { id: true } })).map((u) => u.id);
    return this.availability.occupancy(ctx.user.organizationId, unitId, pros, new Date(q.from), new Date(q.to));
  }

  // ── exceções (folgas, férias, bloqueios, horários especiais, extras) ──

  @RequirePermissions('schedule.read')
  @Get('schedule/exceptions')
  async exceptions(@Ctx() ctx: RequestContext, @Query() q: RangeQuery) {
    const rows = await this.prisma.availabilityException.findMany({
      where: { organizationId: ctx.user.organizationId, startsAt: { lt: new Date(q.to) }, endsAt: { gt: new Date(q.from) }, ...(q.professionalId ? { OR: [{ professionalId: q.professionalId }, { professionalId: null }] } : {}) },
      orderBy: { startsAt: 'asc' },
    });
    const names = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.professionalId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, professionalName: names.find((n) => n.id === r.professionalId)?.name ?? null }));
  }

  @RequirePermissions('schedule.write')
  @Post('schedule/exceptions')
  async addException(@Ctx() ctx: RequestContext, @Body() dto: ExceptionDto) {
    const canAll = ctx.user.permissions.includes('schedule.availability');
    if (!canAll && dto.professionalId !== ctx.user.id) throw new BadRequestException('Você só pode alterar a sua própria disponibilidade');
    if (new Date(dto.endsAt) <= new Date(dto.startsAt)) throw new BadRequestException('O fim deve ser depois do início');
    const unitId = await this.schedule.defaultUnit(ctx, dto.unitId);
    const e = await this.prisma.availabilityException.create({
      data: { organizationId: ctx.user.organizationId, unitId, professionalId: dto.professionalId ?? null, kind: dto.kind, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt), reason: dto.reason ?? null, createdById: ctx.user.id },
    });
    await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'availability_exception', entityId: e.id, summary: `Exceção de agenda: ${dto.kind}${dto.reason ? ` — ${dto.reason}` : ''}` });
    return e;
  }

  @RequirePermissions('schedule.write')
  @HttpCode(204)
  @Delete('schedule/exceptions/:id')
  async removeException(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.prisma.availabilityException.findFirst({ where: { id, organizationId: ctx.user.organizationId } });
    if (!e) notFound('Exceção');
    if (!ctx.user.permissions.includes('schedule.availability') && e.professionalId !== ctx.user.id) throw new BadRequestException('Você só pode alterar a sua própria disponibilidade');
    await this.prisma.availabilityException.delete({ where: { id } });
    await this.audit.record(ctx, { action: AuditAction.DELETE, entity: 'availability_exception', entityId: id, summary: `Exceção de agenda removida (${e.kind})` });
  }

  // ── feriados ──

  @RequirePermissions('schedule.read')
  @Get('schedule/holidays')
  async holidays(@Ctx() ctx: RequestContext) {
    const rows = await this.prisma.holiday.findMany({ where: { organizationId: ctx.user.organizationId }, orderBy: { date: 'asc' } });
    return rows.map((h) => ({ ...h, date: h.date.toISOString().slice(0, 10) }));
  }

  @RequirePermissions('schedule.availability')
  @Post('schedule/holidays')
  async addHoliday(@Ctx() ctx: RequestContext, @Body() dto: HolidayDto) {
    const h = await this.prisma.holiday.upsert({
      where: { organizationId_date: { organizationId: ctx.user.organizationId, date: new Date(`${dto.date}T00:00:00Z`) } },
      create: { organizationId: ctx.user.organizationId, date: new Date(`${dto.date}T00:00:00Z`), name: dto.name, isRecurring: dto.isRecurring ?? false },
      update: { name: dto.name, isRecurring: dto.isRecurring ?? false },
    });
    await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'holiday', entityId: h.id, summary: `Feriado cadastrado: ${dto.name} (${dto.date.split('-').reverse().join('/')})` });
    return { ...h, date: dto.date };
  }

  /** Feriados nacionais do ano (Lei 662/1949 e posteriores, incluindo 20/11 e Sexta-feira Santa). */
  @RequirePermissions('schedule.availability')
  @Post('schedule/holidays/national')
  async national(@Ctx() ctx: RequestContext, @Body() dto: NationalHolidaysDto) {
    const y = dto.year;
    const good = addDays(easter(y), -2).toISOString().slice(0, 10);
    const list: [string, string][] = [
      [`${y}-01-01`, 'Confraternização Universal'], [good, 'Sexta-feira Santa'], [`${y}-04-21`, 'Tiradentes'], [`${y}-05-01`, 'Dia do Trabalho'],
      [`${y}-09-07`, 'Independência do Brasil'], [`${y}-10-12`, 'Nossa Senhora Aparecida'], [`${y}-11-02`, 'Finados'], [`${y}-11-15`, 'Proclamação da República'],
      [`${y}-11-20`, 'Dia Nacional de Zumbi e da Consciência Negra'], [`${y}-12-25`, 'Natal'],
    ];
    for (const [date, name] of list) {
      await this.prisma.holiday.upsert({
        where: { organizationId_date: { organizationId: ctx.user.organizationId, date: new Date(`${date}T00:00:00Z`) } },
        create: { organizationId: ctx.user.organizationId, date: new Date(`${date}T00:00:00Z`), name },
        update: {},
      });
    }
    await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'holiday', summary: `Feriados nacionais de ${y} importados` });
    return this.holidays(ctx);
  }

  @RequirePermissions('schedule.availability')
  @HttpCode(204)
  @Delete('schedule/holidays/:id')
  async removeHoliday(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const h = await this.prisma.holiday.findFirst({ where: { id, organizationId: ctx.user.organizationId } });
    if (!h) notFound('Feriado');
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.record(ctx, { action: AuditAction.DELETE, entity: 'holiday', entityId: id, summary: `Feriado removido: ${h.name}` });
  }

  // ── horário próprio do profissional ──

  @RequirePermissions('schedule.read')
  @Get('schedule/professionals/:id/hours')
  async proHours(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const unitId = await this.schedule.defaultUnit(ctx);
    const rules = await this.prisma.availabilityRule.findMany({ where: { organizationId: ctx.user.organizationId, unitId, professionalId: id }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] });
    return {
      usesUnitHours: rules.length === 0,
      days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: rules.filter((r) => r.weekday === weekday).map((r) => ({ start: r.startTime, end: r.endTime })) })),
    };
  }

  @RequirePermissions('schedule.write')
  @Put('schedule/professionals/:id/hours')
  async saveProHours(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProfessionalHoursDto) {
    if (!ctx.user.permissions.includes('schedule.availability') && id !== ctx.user.id) throw new BadRequestException('Você só pode alterar o seu próprio horário');
    const pro = await this.prisma.user.findFirst({ where: { id, organizationId: ctx.user.organizationId, professional: { isNot: null } } });
    if (!pro) notFound('Profissional');
    const unitId = await this.schedule.defaultUnit(ctx);
    const total = dto.days.reduce((n, d) => n + d.intervals.length, 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.availabilityRule.deleteMany({ where: { organizationId: ctx.user.organizationId, unitId, professionalId: id } });
      if (total > 0) {
        // Reaproveita a validação de sobreposição do cadastro de horários da clínica.
        const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        for (const d of dto.days) {
          const s = [...d.intervals].sort((a, b) => toMin(a.start) - toMin(b.start));
          s.forEach((iv, i) => {
            if (toMin(iv.start) >= toMin(iv.end)) throw new BadRequestException(`Horário inválido: ${iv.start}–${iv.end}`);
            if (i && toMin(iv.start) < toMin(s[i - 1].end)) throw new BadRequestException('Horários sobrepostos');
          });
        }
        await tx.availabilityRule.createMany({
          data: dto.days.flatMap((d) => d.intervals.map((i) => ({ organizationId: ctx.user.organizationId, unitId, professionalId: id, weekday: d.weekday, startTime: i.start, endTime: i.end }))),
        });
      }
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'availability_rules', entityId: id, summary: total ? `Horário próprio de ${pro.name} atualizado` : `${pro.name} passa a seguir o horário da clínica` }, tx);
    });
    return this.proHours(ctx, id);
  }

}
