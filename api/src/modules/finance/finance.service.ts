import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditAction, GoalMetric, PackageStatus, PaymentMethod, PaymentStatus, Prisma, RevenueKind, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { RequestContext } from '../../common/auth/auth.types';
import { EventsService } from '../../common/events';
import { addDays, dateOnly, localDateKey, localToUtc, notFound, paginate, patientScope } from '../../common/helpers';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../schedule/availability.service';
import {
  ExpenseDto,
  GoalsDto,
  ListExpensesQuery,
  ListReceivablesQuery,
  PackageTemplateDto,
  PayDto,
  ReceivableDto,
  SellPackageDto,
  UpdateExpenseDto,
  UpdatePackageDto,
  UpdatePackageTemplateDto,
  UpdateReceivableDto,
} from './finance.dto';

type Tx = Prisma.TransactionClient;

const OPEN: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE];
const dateCol = (key: string) => new Date(`${key}T00:00:00Z`);
const todayKey = () => localDateKey(new Date());
const brl = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

/** Status exibido: pendente com vencimento passado vira "Atrasado". */
export function effectiveStatus(p: { status: PaymentStatus; dueDate: Date }) {
  if ((p.status === 'PENDING' || p.status === 'PARTIAL') && dateOnly(p.dueDate)! < todayKey()) return 'OVERDUE';
  return p.status;
}

function addMonthsKey(key: string, n: number) {
  const [y, m, d] = key.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Divide um valor em N parcelas; os centavos que sobram vão para as primeiras. */
function splitCents(total: number, n: number) {
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly availability: AvailabilityService,
  ) {}

  private org(ctx: RequestContext) {
    return ctx.user.organizationId;
  }

  // ───────────────────────── modelos de pacote ─────────────────────────

  listTemplates(ctx: RequestContext) {
    return this.prisma.packageTemplate.findMany({ where: { organizationId: this.org(ctx) }, orderBy: [{ isActive: 'desc' }, { sessions: 'asc' }] });
  }

  async createTemplate(ctx: RequestContext, dto: PackageTemplateDto) {
    const t = await this.prisma.packageTemplate.create({ data: { ...dto, organizationId: this.org(ctx) } });
    await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'package_template', entityId: t.id, summary: `Modelo de pacote "${t.name}" criado (${t.sessions} sessões, ${brl(t.priceCents)})` });
    return t;
  }

  async updateTemplate(ctx: RequestContext, id: string, dto: UpdatePackageTemplateDto) {
    const before = await this.prisma.packageTemplate.findFirst({ where: { id, organizationId: this.org(ctx) } });
    if (!before) notFound('Modelo de pacote');
    const t = await this.prisma.packageTemplate.update({ where: { id }, data: dto });
    await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'package_template', entityId: id, summary: `Modelo de pacote "${t.name}" atualizado`, changes: AuditService.diff(before, t) });
    return t;
  }

  // ───────────────────────── pacotes vendidos ─────────────────────────

  private async packageRows(where: Prisma.PackageWhereInput) {
    const rows = await this.prisma.package.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      include: {
        patient: { select: { id: true, name: true } },
        _count: { select: { usages: { where: { reversedAt: null } } } },
        payments: { where: { status: { not: PaymentStatus.CANCELLED } }, select: { amountCents: true, paidCents: true } },
        appointments: { where: { startsAt: { gte: new Date() }, status: { in: ['SCHEDULED', 'CONFIRMED'] } }, select: { id: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      patient: p.patient,
      status: p.status,
      contracted: p.contractedSessions,
      used: p._count.usages,
      remaining: Math.max(0, p.contractedSessions - p._count.usages),
      scheduled: p.appointments.length,
      totalPriceCents: p.totalPriceCents,
      perSessionCents: Math.round(p.totalPriceCents / p.contractedSessions),
      paidCents: p.payments.reduce((n, x) => n + x.paidCents, 0),
      openCents: p.payments.reduce((n, x) => n + x.amountCents - x.paidCents, 0),
      startDate: dateOnly(p.startDate),
      expectedEndDate: dateOnly(p.expectedEndDate),
      createdAt: p.createdAt,
    }));
  }

  async patientPackages(ctx: RequestContext, patientId: string) {
    await this.assertPatient(ctx, patientId);
    return this.packageRows({ organizationId: this.org(ctx), patientId });
  }

  async listPackages(ctx: RequestContext, status?: string) {
    return this.packageRows({ organizationId: this.org(ctx), ...(status ? { status: status as PackageStatus } : {}), patient: { deletedAt: null } });
  }

  private async assertPatient(ctx: RequestContext, patientId: string) {
    const p = await this.prisma.patient.findFirst({ where: { AND: [patientScope(ctx), { id: patientId }] }, select: { id: true, name: true } });
    if (!p) notFound('Paciente');
    return p;
  }

  async sellPackage(ctx: RequestContext, patientId: string, dto: SellPackageDto) {
    const patient = await this.assertPatient(ctx, patientId);
    let name = dto.name, sessions = dto.sessions, total = dto.totalPriceCents, validity: number | null = null;
    if (dto.templateId) {
      const t = await this.prisma.packageTemplate.findFirst({ where: { id: dto.templateId, organizationId: this.org(ctx) } });
      if (!t) throw new BadRequestException('Modelo de pacote inválido');
      name ??= t.name;
      sessions ??= t.sessions;
      total ??= t.priceCents;
      validity = t.validityDays;
    }
    if (!name || !sessions || total == null) throw new BadRequestException('Informe nome, número de sessões e valor do pacote');
    const installments = dto.installments ?? 1;
    const firstDue = dto.firstDueDate ?? dto.startDate;
    const expectedEnd = dto.expectedEndDate ?? (validity ? localDateKey(addDays(dateCol(dto.startDate), validity)) : null);
    const result = await this.prisma.$transaction(async (tx) => {
      const pkg = await tx.package.create({
        data: {
          organizationId: this.org(ctx), patientId, templateId: dto.templateId ?? null, name, contractedSessions: sessions!, totalPriceCents: total!,
          startDate: dateCol(dto.startDate), expectedEndDate: expectedEnd ? dateCol(expectedEnd) : null, createdById: ctx.user.id,
        },
      });
      const parts = splitCents(total!, installments);
      const payments = [];
      for (let i = 0; i < installments; i++) {
        payments.push(
          await tx.payment.create({
            data: {
              organizationId: this.org(ctx), patientId, packageId: pkg.id, kind: RevenueKind.PACKAGE,
              description: installments > 1 ? `${name} — parcela ${i + 1}/${installments} — ${patient.name}` : `${name} — ${patient.name}`,
              amountCents: parts[i], dueDate: dateCol(addMonthsKey(firstDue, i)), installment: i + 1, installments, createdById: ctx.user.id,
            },
          }),
        );
      }
      if (dto.paidNowMethod && total! > 0) await this.applyPayment(tx, ctx, payments[0], { amountCents: payments[0].amountCents, method: dto.paidNowMethod });
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'package', entityId: pkg.id, summary: `${patient.name}: pacote "${name}" vendido — ${sessions} sessões, ${brl(total!)}${installments > 1 ? ` em ${installments}x` : ''}` }, tx);
      return pkg;
    });
    return (await this.packageRows({ id: result.id }))[0];
  }

  async updatePackage(ctx: RequestContext, id: string, dto: UpdatePackageDto) {
    const pkg = await this.prisma.package.findFirst({ where: { id, organizationId: this.org(ctx) }, include: { patient: { select: { name: true } } } });
    if (!pkg) notFound('Pacote');
    await this.prisma.$transaction(async (tx) => {
      await tx.package.update({
        where: { id },
        data: { ...(dto.status ? { status: dto.status } : {}), ...(dto.name ? { name: dto.name } : {}), ...(dto.expectedEndDate ? { expectedEndDate: dateCol(dto.expectedEndDate) } : {}) },
      });
      if (dto.status === 'CANCELLED') {
        // Parcelas ainda não pagas do pacote cancelado deixam de ser cobradas.
        await tx.payment.updateMany({ where: { packageId: id, status: PaymentStatus.PENDING, paidCents: 0 }, data: { status: PaymentStatus.CANCELLED } });
        await tx.appointment.updateMany({ where: { packageId: id, startsAt: { gte: new Date() }, status: { in: ['SCHEDULED', 'CONFIRMED'] } }, data: { packageId: null } });
      }
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'package', entityId: id, summary: `${pkg.patient.name}: pacote "${pkg.name}" ${dto.status === 'CANCELLED' ? 'cancelado' : 'atualizado'}`, changes: dto.status ? { status: { from: pkg.status, to: dto.status } } : undefined }, tx);
    });
    return (await this.packageRows({ id }))[0];
  }

  // ───────────────────────── contas a receber ─────────────────────────

  private presentPayment(p: Prisma.PaymentGetPayload<{ include: { patient: { select: { id: true; name: true } }; appointment: { select: { startsAt: true } }; package: { select: { name: true } } } }>) {
    return {
      id: p.id, description: p.description, kind: p.kind, amountCents: p.amountCents, paidCents: p.paidCents, openCents: p.amountCents - p.paidCents,
      dueDate: dateOnly(p.dueDate), status: effectiveStatus(p), method: p.method, paidAt: p.paidAt, installment: p.installment, installments: p.installments,
      notes: p.notes, patient: p.patient, appointmentAt: p.appointment?.startsAt ?? null, package: p.package, createdAt: p.createdAt,
    };
  }

  private statusWhere(status?: string): Prisma.PaymentWhereInput {
    const today = dateCol(todayKey());
    switch (status) {
      case 'OPEN': return { status: { in: OPEN } };
      case 'OVERDUE': return { status: { in: OPEN }, dueDate: { lt: today } };
      case 'PENDING': return { status: { in: [PaymentStatus.PENDING] }, dueDate: { gte: today } };
      case 'PARTIAL': return { status: PaymentStatus.PARTIAL };
      case 'PAID': return { status: PaymentStatus.PAID };
      case 'CANCELLED': return { status: PaymentStatus.CANCELLED };
      default: return {};
    }
  }

  async listReceivables(ctx: RequestContext, q: ListReceivablesQuery) {
    const where: Prisma.PaymentWhereInput = { organizationId: this.org(ctx), ...this.statusWhere(q.status) };
    const and: Prisma.PaymentWhereInput[] = [];
    if (q.from || q.to) and.push({ dueDate: { gte: q.from ? dateCol(q.from) : undefined, lte: q.to ? dateCol(q.to) : undefined } });
    if (q.patientId) and.push({ patientId: q.patientId });
    if (q.method) and.push({ method: q.method });
    if (q.kind) and.push({ kind: q.kind });
    if (q.search) and.push({ OR: [{ description: { contains: q.search, mode: 'insensitive' } }, { patient: { name: { contains: q.search, mode: 'insensitive' } } }] });
    if (and.length) where.AND = and;
    const { skip, take, page, pageSize } = paginate(q.page, q.pageSize, 200);
    const include = { patient: { select: { id: true, name: true } }, appointment: { select: { startsAt: true } }, package: { select: { name: true } } } as const;
    const [total, rows, sums] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({ where, include, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], skip, take }),
      this.prisma.payment.aggregate({ where, _sum: { amountCents: true, paidCents: true } }),
    ]);
    return {
      total, page, pageSize,
      totals: { amountCents: sums._sum.amountCents ?? 0, paidCents: sums._sum.paidCents ?? 0, openCents: (sums._sum.amountCents ?? 0) - (sums._sum.paidCents ?? 0) },
      items: rows.map((r) => this.presentPayment(r)),
    };
  }

  async createReceivable(ctx: RequestContext, dto: ReceivableDto) {
    let patientName = '';
    if (dto.patientId) patientName = (await this.assertPatient(ctx, dto.patientId)).name;
    const p = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: { organizationId: this.org(ctx), patientId: dto.patientId ?? null, kind: dto.kind ?? RevenueKind.OTHER, description: dto.description, amountCents: dto.amountCents, dueDate: dateCol(dto.dueDate), notes: dto.notes ?? null, createdById: ctx.user.id },
      });
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'payment', entityId: created.id, summary: `Cobrança lançada: ${dto.description}${patientName ? ` (${patientName})` : ''} — ${brl(dto.amountCents)}` }, tx);
      return created;
    });
    return this.getReceivable(ctx, p.id);
  }

  async getReceivable(ctx: RequestContext, id: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id, organizationId: this.org(ctx) },
      include: { patient: { select: { id: true, name: true } }, appointment: { select: { startsAt: true } }, package: { select: { name: true } }, transactions: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!p) notFound('Cobrança');
    return { ...this.presentPayment(p), transactions: p.transactions };
  }

  async updateReceivable(ctx: RequestContext, id: string, dto: UpdateReceivableDto) {
    const p = await this.prisma.payment.findFirst({ where: { id, organizationId: this.org(ctx) } });
    if (!p) notFound('Cobrança');
    if (p.status === 'PAID' || p.status === 'CANCELLED') throw new BadRequestException('Cobrança paga ou cancelada não pode ser alterada');
    if (dto.amountCents !== undefined && dto.amountCents < p.paidCents) throw new BadRequestException('O valor não pode ser menor que o já recebido');
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.payment.update({ where: { id }, data: { ...dto, ...(dto.dueDate ? { dueDate: dateCol(dto.dueDate) } : {}) } });
      if (dto.amountCents !== undefined && u.paidCents >= u.amountCents) await tx.payment.update({ where: { id }, data: { status: PaymentStatus.PAID, paidAt: u.paidAt ?? new Date() } });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'payment', entityId: id, summary: `Cobrança alterada: ${u.description}`, changes: AuditService.diff(p, u) }, tx);
    });
    return this.getReceivable(ctx, id);
  }

  /** Registra o recebimento (total ou parcial) e lança no caixa. */
  private async applyPayment(tx: Tx, ctx: RequestContext, p: { id: string; amountCents: number; paidCents: number; description: string; status: PaymentStatus }, dto: PayDto) {
    const open = p.amountCents - p.paidCents;
    if (p.status === 'CANCELLED') throw new BadRequestException('Cobrança cancelada');
    if (open <= 0) throw new BadRequestException('Esta cobrança já está paga');
    if (dto.amountCents > open) throw new BadRequestException(`O valor excede o saldo em aberto (${brl(open)})`);
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('A data do recebimento não pode estar no futuro');
    const paidCents = p.paidCents + dto.amountCents;
    const full = paidCents >= p.amountCents;
    await tx.payment.update({ where: { id: p.id }, data: { paidCents, status: full ? PaymentStatus.PAID : PaymentStatus.PARTIAL, method: dto.method, ...(full ? { paidAt } : {}) } });
    await tx.financialTransaction.create({
      data: { organizationId: this.org(ctx), direction: TransactionDirection.IN, amountCents: dto.amountCents, method: dto.method, occurredAt: paidAt, paymentId: p.id, description: p.description, createdById: ctx.user.id },
    });
    await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'payment', entityId: p.id, summary: `Recebimento de ${brl(dto.amountCents)} (${dto.method}) — ${p.description}${full ? '' : ' (parcial)'}` }, tx);
    return full;
  }

  async pay(ctx: RequestContext, id: string, dto: PayDto) {
    const p = await this.prisma.payment.findFirst({ where: { id, organizationId: this.org(ctx) } });
    if (!p) notFound('Cobrança');
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: this.org(ctx) } });
    if (!settings.acceptedPaymentMethods.includes(dto.method)) throw new BadRequestException('Forma de pagamento não aceita pela clínica (ajuste em Configurações)');
    await this.prisma.$transaction((tx) => this.applyPayment(tx, ctx, p, dto));
    this.events.emit('payment.received', { organizationId: this.org(ctx), actorUserId: ctx.user.id, entityId: id, data: { amountCents: dto.amountCents } });
    return this.getReceivable(ctx, id);
  }

  async cancelReceivable(ctx: RequestContext, id: string, reason: string) {
    const p = await this.prisma.payment.findFirst({ where: { id, organizationId: this.org(ctx) } });
    if (!p) notFound('Cobrança');
    if (p.paidCents > 0) throw new ConflictException('Esta cobrança já tem valores recebidos e não pode ser cancelada');
    if (p.status === 'CANCELLED') return this.getReceivable(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id }, data: { status: PaymentStatus.CANCELLED, notes: [p.notes, `Cancelada: ${reason}`].filter(Boolean).join('\n') } });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'payment', entityId: id, summary: `Cobrança cancelada: ${p.description} — ${reason}` }, tx);
    });
    return this.getReceivable(ctx, id);
  }

  // ───────────────────────── despesas ─────────────────────────

  listCategories(ctx: RequestContext) {
    return this.prisma.expenseCategory.findMany({ where: { organizationId: this.org(ctx) }, orderBy: { name: 'asc' } });
  }

  async createCategory(ctx: RequestContext, name: string) {
    try {
      return await this.prisma.expenseCategory.create({ data: { organizationId: this.org(ctx), name } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Categoria já existe');
      throw e;
    }
  }

  private presentExpense(e: Prisma.ExpenseGetPayload<{ include: { category: true } }>) {
    return { ...e, dueDate: dateOnly(e.dueDate), status: effectiveStatus(e), openCents: e.amountCents - e.paidCents, category: { id: e.category.id, name: e.category.name } };
  }

  async listExpenses(ctx: RequestContext, q: ListExpensesQuery) {
    const today = dateCol(todayKey());
    const where: Prisma.ExpenseWhereInput = { organizationId: this.org(ctx) };
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.from || q.to) where.dueDate = { gte: q.from ? dateCol(q.from) : undefined, lte: q.to ? dateCol(q.to) : undefined };
    if (q.status === 'OPEN') where.status = { in: OPEN };
    else if (q.status === 'OVERDUE') Object.assign(where, { status: { in: OPEN }, dueDate: { ...(where.dueDate as object), lt: today } });
    else if (q.status) where.status = q.status as PaymentStatus;
    const rows = await this.prisma.expense.findMany({ where, include: { category: true }, orderBy: { dueDate: 'asc' }, take: 500 });
    const items = rows.map((r) => this.presentExpense(r));
    return {
      items,
      totals: {
        amountCents: items.filter((i) => i.status !== 'CANCELLED').reduce((n, i) => n + i.amountCents, 0),
        paidCents: items.reduce((n, i) => n + i.paidCents, 0),
        openCents: items.filter((i) => i.status !== 'CANCELLED').reduce((n, i) => n + i.openCents, 0),
      },
    };
  }

  async createExpense(ctx: RequestContext, dto: ExpenseDto) {
    const cat = await this.prisma.expenseCategory.findFirst({ where: { id: dto.categoryId, organizationId: this.org(ctx) } });
    if (!cat) throw new BadRequestException('Categoria inválida');
    const months = dto.repeatMonths ?? 1;
    const created = await this.prisma.$transaction(async (tx) => {
      const list = [];
      for (let i = 0; i < months; i++) {
        list.push(
          await tx.expense.create({
            data: {
              organizationId: this.org(ctx), categoryId: dto.categoryId, description: months > 1 ? `${dto.description} (${i + 1}/${months})` : dto.description,
              amountCents: dto.amountCents, dueDate: dateCol(addMonthsKey(dto.dueDate, i)), supplier: dto.supplier ?? null, isRecurring: months > 1 || !!dto.isRecurring,
              notes: dto.notes ?? null, createdById: ctx.user.id,
            },
          }),
        );
      }
      if (dto.paidNowMethod) await this.applyExpensePayment(tx, ctx, list[0], dto.amountCents, dto.paidNowMethod);
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'expense', entityId: list[0].id, summary: `Despesa lançada: ${dto.description} (${cat.name}) — ${brl(dto.amountCents)}${months > 1 ? ` × ${months} meses` : ''}` }, tx);
      return list;
    });
    return { created: created.length };
  }

  async updateExpense(ctx: RequestContext, id: string, dto: UpdateExpenseDto) {
    const e = await this.prisma.expense.findFirst({ where: { id, organizationId: this.org(ctx) } });
    if (!e) notFound('Despesa');
    if (e.status === 'PAID' || e.status === 'CANCELLED') throw new BadRequestException('Despesa paga ou cancelada não pode ser alterada');
    const { repeatMonths: _r, paidNowMethod: _p, dueDate, ...rest } = dto;
    const u = await this.prisma.expense.update({ where: { id }, data: { ...rest, ...(dueDate ? { dueDate: dateCol(dueDate) } : {}) }, include: { category: true } });
    await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'expense', entityId: id, summary: `Despesa alterada: ${u.description}`, changes: AuditService.diff(e, u) });
    return this.presentExpense(u);
  }

  private async applyExpensePayment(tx: Tx, ctx: RequestContext, e: { id: string; amountCents: number; paidCents: number; description: string }, amount: number, method: PaymentMethod, paidAt = new Date()) {
    const open = e.amountCents - e.paidCents;
    if (amount > open) throw new BadRequestException(`O valor excede o saldo em aberto (${brl(open)})`);
    const paidCents = e.paidCents + amount;
    const full = paidCents >= e.amountCents;
    await tx.expense.update({ where: { id: e.id }, data: { paidCents, method, status: full ? PaymentStatus.PAID : PaymentStatus.PARTIAL, ...(full ? { paidAt } : {}) } });
    await tx.financialTransaction.create({ data: { organizationId: this.org(ctx), direction: TransactionDirection.OUT, amountCents: amount, method, occurredAt: paidAt, expenseId: e.id, description: e.description, createdById: ctx.user.id } });
  }

  async payExpense(ctx: RequestContext, id: string, dto: PayDto) {
    const e = await this.prisma.expense.findFirst({ where: { id, organizationId: this.org(ctx) } });
    if (!e) notFound('Despesa');
    if (e.status === 'CANCELLED' || e.status === 'PAID') throw new BadRequestException('Despesa já paga ou cancelada');
    await this.prisma.$transaction(async (tx) => {
      await this.applyExpensePayment(tx, ctx, e, dto.amountCents, dto.method, dto.paidAt ? new Date(dto.paidAt) : new Date());
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'expense', entityId: id, summary: `Pagamento de despesa: ${e.description} — ${brl(dto.amountCents)}` }, tx);
    });
    return this.presentExpense(await this.prisma.expense.findUniqueOrThrow({ where: { id }, include: { category: true } }));
  }

  async cancelExpense(ctx: RequestContext, id: string, reason: string) {
    const e = await this.prisma.expense.findFirst({ where: { id, organizationId: this.org(ctx) } });
    if (!e) notFound('Despesa');
    if (e.paidCents > 0) throw new ConflictException('Despesa com pagamento registrado não pode ser cancelada');
    await this.prisma.expense.update({ where: { id }, data: { status: PaymentStatus.CANCELLED, notes: [e.notes, `Cancelada: ${reason}`].filter(Boolean).join('\n') } });
    await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'expense', entityId: id, summary: `Despesa cancelada: ${e.description} — ${reason}` });
  }

  // ───────────────────────── caixa ─────────────────────────

  async transactions(ctx: RequestContext, from: string, to: string) {
    const rows = await this.prisma.financialTransaction.findMany({
      where: { organizationId: this.org(ctx), occurredAt: { gte: localToUtc(from, '00:00'), lt: addDays(localToUtc(to, '00:00'), 1) } },
      orderBy: { occurredAt: 'desc' },
      include: { payment: { select: { patient: { select: { id: true, name: true } }, kind: true } }, expense: { select: { category: { select: { name: true } } } } },
      take: 1000,
    });
    const inSum = rows.filter((r) => r.direction === 'IN').reduce((n, r) => n + r.amountCents, 0);
    const outSum = rows.filter((r) => r.direction === 'OUT').reduce((n, r) => n + r.amountCents, 0);
    return {
      totals: { inCents: inSum, outCents: outSum, balanceCents: inSum - outSum },
      items: rows.map((r) => ({ id: r.id, direction: r.direction, amountCents: r.amountCents, method: r.method, occurredAt: r.occurredAt, description: r.description, patient: r.payment?.patient ?? null, category: r.expense?.category.name ?? null, kind: r.payment?.kind ?? null })),
    };
  }

  // ───────────────────────── resumo e indicadores ─────────────────────────

  async summary(ctx: RequestContext, from: string, to: string) {
    const org = this.org(ctx);
    const start = localToUtc(from, '00:00');
    const end = addDays(localToUtc(to, '00:00'), 1);
    const today = dateCol(todayKey());
    const [txs, billed, overdue, sessions, expenseByCat] = await Promise.all([
      this.prisma.financialTransaction.findMany({ where: { organizationId: org, occurredAt: { gte: start, lt: end } }, select: { direction: true, amountCents: true, method: true, payment: { select: { kind: true } } } }),
      this.prisma.payment.findMany({ where: { organizationId: org, status: { not: 'CANCELLED' }, dueDate: { gte: dateCol(from), lte: dateCol(to) } }, select: { amountCents: true, paidCents: true, patientId: true, kind: true } }),
      this.prisma.payment.aggregate({ where: { organizationId: org, status: { in: OPEN }, dueDate: { lt: today } }, _sum: { amountCents: true, paidCents: true }, _count: true }),
      this.prisma.treatmentSession.count({ where: { organizationId: org, performedAt: { gte: start, lt: end }, evolution: { deletedAt: null } } }),
      this.prisma.expense.groupBy({ by: ['categoryId'], where: { organizationId: org, status: { not: 'CANCELLED' }, dueDate: { gte: dateCol(from), lte: dateCol(to) } }, _sum: { amountCents: true } }),
    ]);
    const received = txs.filter((t) => t.direction === 'IN').reduce((n, t) => n + t.amountCents, 0);
    const expensesPaid = txs.filter((t) => t.direction === 'OUT').reduce((n, t) => n + t.amountCents, 0);
    const billedTotal = billed.reduce((n, b) => n + b.amountCents, 0);
    const byMethod: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const t of txs.filter((x) => x.direction === 'IN')) {
      byMethod[t.method] = (byMethod[t.method] ?? 0) + t.amountCents;
      const k = t.payment?.kind ?? 'OTHER';
      byKind[k] = (byKind[k] ?? 0) + t.amountCents;
    }
    const cats = await this.prisma.expenseCategory.findMany({ where: { organizationId: org }, select: { id: true, name: true } });
    const billedDueSoFar = await this.prisma.payment.aggregate({ where: { organizationId: org, status: { not: 'CANCELLED' }, dueDate: { lt: today } }, _sum: { amountCents: true } });
    const overdueCents = (overdue._sum.amountCents ?? 0) - (overdue._sum.paidCents ?? 0);
    const patients = new Set(billed.map((b) => b.patientId).filter(Boolean)).size;
    return {
      period: { from, to },
      receivedCents: received,
      expensesPaidCents: expensesPaid,
      balanceCents: received - expensesPaid,
      billedCents: billedTotal,
      openInPeriodCents: billed.reduce((n, b) => n + b.amountCents - b.paidCents, 0),
      overdueCents,
      overdueCount: overdue._count,
      // Inadimplência: atrasado ÷ tudo o que já venceu.
      delinquencyRate: billedDueSoFar._sum.amountCents ? overdueCents / billedDueSoFar._sum.amountCents : 0,
      sessions,
      averageTicketCents: billed.length ? Math.round(billedTotal / billed.length) : 0,
      revenuePerSessionCents: sessions ? Math.round(billedTotal / sessions) : 0,
      revenuePerPatientCents: patients ? Math.round(billedTotal / patients) : 0,
      byMethod,
      byKind,
      expensesByCategory: expenseByCat.map((e) => ({ category: cats.find((c) => c.id === e.categoryId)?.name ?? '—', amountCents: e._sum.amountCents ?? 0 })).sort((a, b) => b.amountCents - a.amountCents),
    };
  }

  /** Série mensal (recebido × despesas pagas) dos últimos N meses, para o gráfico. */
  async monthly(ctx: RequestContext, months = 6) {
    const cur = todayKey().slice(0, 7);
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const first = addMonthsKey(`${cur}-01`, -i);
      const next = addMonthsKey(first, 1);
      const rows = await this.prisma.financialTransaction.groupBy({
        by: ['direction'],
        where: { organizationId: this.org(ctx), occurredAt: { gte: localToUtc(first, '00:00'), lt: localToUtc(next, '00:00') } },
        _sum: { amountCents: true },
      });
      const billed = await this.prisma.payment.aggregate({ where: { organizationId: this.org(ctx), status: { not: 'CANCELLED' }, dueDate: { gte: dateCol(first), lt: dateCol(next) } }, _sum: { amountCents: true } });
      out.push({
        month: first.slice(0, 7),
        receivedCents: rows.find((r) => r.direction === 'IN')?._sum.amountCents ?? 0,
        expensesCents: rows.find((r) => r.direction === 'OUT')?._sum.amountCents ?? 0,
        billedCents: billed._sum.amountCents ?? 0,
      });
    }
    return out;
  }

  // ───────────────────────── projeção: "Quanto vou faturar?" ─────────────────────────

  /**
   * Para uma janela [from, to] (datas locais):
   *  realizada  = dinheiro que entrou no caixa (até hoje)
   *  prevista   = agenda futura (sessões fora de pacote × valor) + parcelas/cobranças a vencer
   *  potencial  = prevista + horários livres × valor da sessão (se a agenda lotasse)
   *  perdida    = cancelamentos e faltas × valor
   *  em atraso  = cobranças vencidas e não pagas (independe da janela)
   */
  async projectWindow(ctx: RequestContext, from: string, to: string) {
    const org = this.org(ctx);
    const now = new Date();
    const start = localToUtc(from, '00:00');
    const end = addDays(localToUtc(to, '00:00'), 1);
    const futureStart = start > now ? start : now;
    const today = todayKey();
    const [settings, received, futureAppts, lostAppts, pending] = await Promise.all([
      this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: org } }),
      this.prisma.financialTransaction.aggregate({ where: { organizationId: org, direction: 'IN', occurredAt: { gte: start, lt: end < now ? end : now } }, _sum: { amountCents: true } }),
      futureStart < end
        ? this.prisma.appointment.findMany({
            where: { organizationId: org, status: { in: ['SCHEDULED', 'CONFIRMED'] }, startsAt: { gte: futureStart, lt: end }, patientId: { not: null } },
            select: { priceCents: true, packageId: true, seriesId: true, patientId: true, payments: { where: { status: { not: 'CANCELLED' } }, select: { id: true } } },
          })
        : [],
      this.prisma.appointment.findMany({ where: { organizationId: org, status: { in: ['CANCELLED', 'NO_SHOW'] }, startsAt: { gte: start, lt: end }, packageId: null }, select: { priceCents: true, status: true } }),
      this.prisma.payment.findMany({
        where: { organizationId: org, status: { in: OPEN }, dueDate: { gte: dateCol(from > today ? from : today), lte: dateCol(to) } },
        select: { amountCents: true, paidCents: true, packageId: true },
      }),
    ]);
    // Pacientes com pacote ativo com saldo: suas sessões já estão pagas/parceladas no pacote.
    const withPackage = new Set(
      (await this.prisma.package.findMany({ where: { organizationId: org, status: 'ACTIVE' }, select: { patientId: true, contractedSessions: true, _count: { select: { usages: { where: { reversedAt: null } } } } } }))
        .filter((p) => p._count.usages < p.contractedSessions)
        .map((p) => p.patientId),
    );
    const billable = futureAppts.filter((a) => !a.packageId && !withPackage.has(a.patientId!) && a.payments.length === 0);
    const agendaCents = billable.reduce((n, a) => n + a.priceCents, 0);
    const recurringCents = billable.filter((a) => a.seriesId).reduce((n, a) => n + a.priceCents, 0);
    const packagesCents = pending.filter((p) => p.packageId).reduce((n, p) => n + p.amountCents - p.paidCents, 0);
    const otherReceivablesCents = pending.filter((p) => !p.packageId).reduce((n, p) => n + p.amountCents - p.paidCents, 0);
    const expected = agendaCents + packagesCents + otherReceivablesCents;

    let freeSessions = 0;
    if (futureStart < end && settings.defaultSessionMinutes > 0) {
      const pros = await this.prisma.user.findMany({ where: { organizationId: org, isActive: true, professional: { isNot: null } }, select: { id: true } });
      const unit = await this.prisma.unit.findFirst({ where: { organizationId: org, isActive: true }, orderBy: { createdAt: 'asc' } });
      if (unit && pros.length) {
        const occ = await this.availability.occupancy(org, unit.id, pros.map((p) => p.id), futureStart, end);
        freeSessions = Math.floor(Math.max(0, occ.availableMin - occ.bookedMin) / settings.defaultSessionMinutes);
      }
    }
    const lostCents = lostAppts.reduce((n, a) => n + a.priceCents, 0);
    return {
      from,
      to,
      realizedCents: received._sum.amountCents ?? 0,
      expectedCents: expected,
      potentialCents: expected + freeSessions * settings.defaultSessionPriceCents,
      lostCents,
      breakdown: {
        agendaSessions: billable.length,
        agendaCents,
        averageSessionCents: billable.length ? Math.round(agendaCents / billable.length) : settings.defaultSessionPriceCents,
        recurringCents,
        packagesCents,
        otherReceivablesCents,
        packageCoveredSessions: futureAppts.length - billable.length,
        freeSessions,
        cancellations: lostAppts.filter((a) => a.status === 'CANCELLED').length,
        noShows: lostAppts.filter((a) => a.status === 'NO_SHOW').length,
      },
    };
  }

  async projection(ctx: RequestContext) {
    const t = todayKey();
    const wd = new Date(`${t}T12:00:00Z`).getUTCDay();
    const monday = localDateKey(addDays(localToUtc(t, '12:00'), wd === 0 ? -6 : 1 - wd));
    const monthStart = `${t.slice(0, 7)}-01`;
    const monthEnd = addMonthsKey(monthStart, 1);
    const lastDay = (k: string) => localDateKey(addDays(localToUtc(k, '12:00'), -1));
    const windows: [string, string, string, string][] = [
      ['today', 'Hoje', t, t],
      ['week', 'Esta semana', monday, localDateKey(addDays(localToUtc(monday, '12:00'), 6))],
      ['month', 'Este mês', monthStart, lastDay(monthEnd)],
      ['nextMonth', 'Próximo mês', monthEnd, lastDay(addMonthsKey(monthEnd, 1))],
      ['3m', 'Próximos 3 meses', t, lastDay(addMonthsKey(t, 3))],
      ['6m', 'Próximos 6 meses', t, lastDay(addMonthsKey(t, 6))],
      ['12m', 'Próximos 12 meses', t, lastDay(addMonthsKey(t, 12))],
    ];
    const out = [];
    for (const [key, label, from, to] of windows) out.push({ key, label, ...(await this.projectWindow(ctx, from, to)) });
    const overdue = await this.prisma.payment.aggregate({ where: { organizationId: this.org(ctx), status: { in: OPEN }, dueDate: { lt: dateCol(t) } }, _sum: { amountCents: true, paidCents: true } });
    return { windows: out, overdueCents: (overdue._sum.amountCents ?? 0) - (overdue._sum.paidCents ?? 0) };
  }

  // ───────────────────────── metas ─────────────────────────

  async goals(ctx: RequestContext, month = todayKey().slice(0, 7)) {
    const org = this.org(ctx);
    const first = `${month}-01`;
    const next = addMonthsKey(first, 1);
    const last = localDateKey(addDays(localToUtc(next, '12:00'), -1));
    const start = localToUtc(first, '00:00');
    const end = localToUtc(next, '00:00');
    const now = new Date();
    const [goals, billed, sessions, newPatients, scheduled, proj] = await Promise.all([
      this.prisma.goal.findMany({ where: { organizationId: org, periodStart: dateCol(first) } }),
      this.prisma.payment.aggregate({ where: { organizationId: org, status: { not: 'CANCELLED' }, dueDate: { gte: dateCol(first), lt: dateCol(next) } }, _sum: { amountCents: true } }),
      this.prisma.treatmentSession.count({ where: { organizationId: org, performedAt: { gte: start, lt: end }, evolution: { deletedAt: null } } }),
      this.prisma.patient.count({ where: { organizationId: org, createdAt: { gte: start, lt: end }, deletedAt: null } }),
      this.prisma.appointment.count({ where: { organizationId: org, startsAt: { gte: now > start ? now : start, lt: end }, status: { in: ['SCHEDULED', 'CONFIRMED'] }, patientId: { not: null } } }),
      this.projectWindow(ctx, first, last),
    ]);
    const totalDays = Number(last.slice(8));
    const elapsed = now >= end ? totalDays : now < start ? 0 : Number(todayKey().slice(8));
    const target = (m: GoalMetric) => goals.find((g) => g.metric === m)?.target ?? null;
    const billedCents = billed._sum.amountCents ?? 0;
    const row = (metric: GoalMetric, realized: number, projection: number) => {
      const t = target(metric);
      return { metric, target: t, realized, percent: t ? realized / t : null, projection, projectedPercent: t ? projection / t : null };
    };
    return {
      month,
      daysElapsed: elapsed,
      daysInMonth: totalDays,
      items: [
        row(GoalMetric.REVENUE, billedCents, billedCents + proj.breakdown.agendaCents),
        row(GoalMetric.SESSIONS, sessions, sessions + scheduled),
        row(GoalMetric.NEW_PATIENTS, newPatients, elapsed ? Math.round((newPatients / elapsed) * totalDays) : newPatients),
      ],
    };
  }

  async saveGoals(ctx: RequestContext, dto: GoalsDto) {
    const org = this.org(ctx);
    const first = `${dto.month}-01`;
    const next = addMonthsKey(first, 1);
    const entries: [GoalMetric, number | null | undefined][] = [
      [GoalMetric.REVENUE, dto.revenueCents],
      [GoalMetric.SESSIONS, dto.sessions],
      [GoalMetric.NEW_PATIENTS, dto.newPatients],
    ];
    await this.prisma.$transaction(async (tx) => {
      for (const [metric, target] of entries) {
        if (target === undefined) continue;
        if (target === null) {
          await tx.goal.deleteMany({ where: { organizationId: org, metric, periodStart: dateCol(first) } });
          continue;
        }
        await tx.goal.upsert({
          where: { organizationId_metric_periodStart: { organizationId: org, metric, periodStart: dateCol(first) } },
          create: { organizationId: org, metric, periodStart: dateCol(first), periodEnd: addDays(dateCol(next), -1), target },
          update: { target },
        });
      }
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'goal', summary: `Metas de ${dto.month.split('-').reverse().join('/')} atualizadas`, metadata: dto as unknown as Record<string, unknown> }, tx);
    });
    return this.goals(ctx, dto.month);
  }
}
