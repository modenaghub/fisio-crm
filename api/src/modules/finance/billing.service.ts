import { Injectable } from '@nestjs/common';
import { AuditAction, PackageStatus, PaymentStatus, Prisma, RevenueKind } from '@prisma/client';
import type { RequestContext } from '../../common/auth/auth.types';
import { AuditService } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;

/**
 * Regras financeiras disparadas por um atendimento realizado:
 *  1. se o paciente tem pacote com saldo, desconta 1 sessão do pacote;
 *  2. senão, gera a conta a receber da sessão (se ainda não existir para o agendamento).
 */
@Injectable()
export class BillingService {
  constructor(private readonly audit: AuditService) {}

  async activePackageWithBalance(tx: Tx, patientId: string, preferredId?: string | null) {
    const pkgs = await tx.package.findMany({
      where: { patientId, status: PackageStatus.ACTIVE, ...(preferredId ? { id: preferredId } : {}) },
      orderBy: { startDate: 'asc' },
      include: { _count: { select: { usages: { where: { reversedAt: null } } } } },
    });
    return pkgs.find((p) => p._count.usages < p.contractedSessions) ?? null;
  }

  async sessionPrice(tx: Tx, organizationId: string, appointment?: { priceCents: number; serviceId: string | null } | null) {
    if (appointment?.priceCents) return appointment.priceCents;
    if (appointment?.serviceId) {
      const s = await tx.service.findUnique({ where: { id: appointment.serviceId } });
      if (s?.priceCents) return s.priceCents;
    }
    const settings = await tx.businessSettings.findUnique({ where: { organizationId } });
    return settings?.defaultSessionPriceCents ?? 0;
  }

  async onSessionPerformed(
    tx: Tx,
    ctx: RequestContext,
    input: {
      patientId: string;
      patientName: string;
      sessionId: string;
      sessionNumber: number;
      performedAt: Date;
      unitId?: string | null;
      appointment?: { id: string; priceCents: number; serviceId: string | null; packageId: string | null; service?: { kind: string; name: string } | null } | null;
    },
  ): Promise<{ packageId: string | null; remaining: number | null; paymentId: string | null }> {
    const pkg = await this.activePackageWithBalance(tx, input.patientId, input.appointment?.packageId ?? null)
      ?? (input.appointment?.packageId ? await this.activePackageWithBalance(tx, input.patientId) : null);

    if (pkg && input.appointment?.service?.kind !== 'EVALUATION') {
      await tx.packageSession.create({ data: { packageId: pkg.id, sessionId: input.sessionId, usedAt: input.performedAt } });
      const used = pkg._count.usages + 1;
      if (used >= pkg.contractedSessions) {
        await tx.package.update({ where: { id: pkg.id }, data: { status: PackageStatus.COMPLETED } });
      }
      await this.audit.record(
        ctx,
        { action: AuditAction.UPDATE, entity: 'package', entityId: pkg.id, summary: `${input.patientName}: sessão ${input.sessionNumber} descontada do pacote "${pkg.name}" (${used}/${pkg.contractedSessions})` },
        tx,
      );
      return { packageId: pkg.id, remaining: pkg.contractedSessions - used, paymentId: null };
    }

    if (input.appointment) {
      const existing = await tx.payment.findFirst({ where: { appointmentId: input.appointment.id, status: { not: PaymentStatus.CANCELLED } } });
      if (existing) return { packageId: null, remaining: null, paymentId: existing.id };
    }
    const price = await this.sessionPrice(tx, ctx.user.organizationId, input.appointment);
    if (price <= 0) return { packageId: null, remaining: null, paymentId: null };
    const isEval = input.appointment?.service?.kind === 'EVALUATION';
    const due = new Date(input.performedAt);
    const payment = await tx.payment.create({
      data: {
        organizationId: ctx.user.organizationId,
        unitId: input.unitId ?? null,
        patientId: input.patientId,
        appointmentId: input.appointment?.id ?? null,
        kind: isEval ? RevenueKind.EVALUATION : RevenueKind.SESSION,
        description: isEval ? `Avaliação — ${input.patientName}` : `${input.appointment?.service?.name ?? 'Sessão'} ${String(input.sessionNumber).padStart(2, '0')} — ${input.patientName}`,
        amountCents: price,
        dueDate: new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())),
        createdById: ctx.user.id,
      },
    });
    return { packageId: null, remaining: null, paymentId: payment.id };
  }

  /** Cobrança avulsa de um agendamento (ex.: avaliação), se ainda não existir. */
  async chargeAppointment(
    tx: Tx,
    ctx: RequestContext,
    appt: { id: string; unitId: string; patientId: string | null; priceCents: number; serviceId: string | null; startsAt: Date; service?: { kind: string; name: string } | null },
    patientName: string,
  ) {
    const existing = await tx.payment.findFirst({ where: { appointmentId: appt.id, status: { not: PaymentStatus.CANCELLED } } });
    if (existing) return existing.id;
    const price = await this.sessionPrice(tx, ctx.user.organizationId, appt);
    if (price <= 0) return null;
    const d = appt.startsAt;
    const p = await tx.payment.create({
      data: {
        organizationId: ctx.user.organizationId,
        unitId: appt.unitId,
        patientId: appt.patientId,
        appointmentId: appt.id,
        kind: appt.service?.kind === 'EVALUATION' ? RevenueKind.EVALUATION : RevenueKind.OTHER,
        description: `${appt.service?.name ?? 'Atendimento'} — ${patientName}`,
        amountCents: price,
        dueDate: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
        createdById: ctx.user.id,
      },
    });
    return p.id;
  }

  /** Estorna o desconto de pacote de uma sessão excluída. */
  async reverseSession(tx: Tx, sessionId: string) {
    const usage = await tx.packageSession.findUnique({ where: { sessionId } });
    if (usage && !usage.reversedAt) {
      await tx.packageSession.update({ where: { id: usage.id }, data: { reversedAt: new Date() } });
      await tx.package.updateMany({ where: { id: usage.packageId, status: PackageStatus.COMPLETED }, data: { status: PackageStatus.ACTIVE } });
    }
  }
}
