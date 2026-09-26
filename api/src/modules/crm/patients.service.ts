import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AppointmentStatus, AuditAction, ConsentPurpose, PackageStatus, PatientStage, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import type { RequestContext } from '../../common/auth/auth.types';
import {
  ageFrom,
  can,
  dateOnly,
  digits,
  formatCpf,
  maskCpf,
  notFound,
  paginate,
  patientCode,
  patientScope,
  toDate,
} from '../../common/helpers';
import { AuditService } from '../audit/audit.service';
import { ListPatientsQuery, PatientDto, UpdatePatientDto } from './crm.dto';

export const PATIENT_STAGE_LABELS: Record<PatientStage, string> = {
  TREATMENT_STARTED: 'Tratamento iniciado',
  ACTIVE: 'Paciente ativo',
  IN_TREATMENT: 'Tratamento em andamento',
  DISCHARGED: 'Alta',
  INACTIVE: 'Paciente inativo',
  REACTIVATION: 'Reativação',
};

const OPEN_APPOINTMENT: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'];

type Tx = Prisma.TransactionClient;

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── leitura ─────────────────────────

  /** Resumo operacional por paciente: próxima sessão, última sessão, pacote ativo e saldo. */
  async summaries(patientIds: string[]) {
    if (!patientIds.length) return new Map<string, Summary>();
    const now = new Date();
    const [next, last, packages, due] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { patientId: { in: patientIds }, startsAt: { gte: now }, status: { in: OPEN_APPOINTMENT } },
        orderBy: { startsAt: 'asc' },
        select: { patientId: true, startsAt: true, service: { select: { name: true } } },
      }),
      this.prisma.treatmentSession.groupBy({
        by: ['patientId'],
        where: { patientId: { in: patientIds } },
        _max: { performedAt: true },
        _count: { _all: true },
      }),
      this.prisma.package.findMany({
        where: { patientId: { in: patientIds }, status: PackageStatus.ACTIVE },
        orderBy: { startDate: 'desc' },
        select: {
          id: true, patientId: true, name: true, contractedSessions: true, totalPriceCents: true,
          _count: { select: { usages: { where: { reversedAt: null } } } },
        },
      }),
      this.prisma.payment.groupBy({
        by: ['patientId'],
        where: { patientId: { in: patientIds }, status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE] } },
        _sum: { amountCents: true, paidCents: true },
      }),
    ]);
    const map = new Map<string, Summary>();
    for (const id of patientIds) map.set(id, { nextAppointment: null, lastSessionAt: null, sessionsDone: 0, activePackage: null, balanceDueCents: 0 });
    for (const a of next) {
      const s = map.get(a.patientId!)!;
      if (!s.nextAppointment) s.nextAppointment = { startsAt: a.startsAt, service: a.service?.name ?? null };
    }
    for (const l of last) {
      const s = map.get(l.patientId)!;
      s.lastSessionAt = l._max.performedAt;
      s.sessionsDone = l._count._all;
    }
    for (const p of packages) {
      const s = map.get(p.patientId)!;
      if (!s.activePackage) {
        s.activePackage = {
          id: p.id,
          name: p.name,
          contracted: p.contractedSessions,
          used: p._count.usages,
          remaining: Math.max(0, p.contractedSessions - p._count.usages),
          totalPriceCents: p.totalPriceCents,
        };
      }
    }
    for (const d of due) {
      if (d.patientId) map.get(d.patientId)!.balanceDueCents = (d._sum.amountCents ?? 0) - (d._sum.paidCents ?? 0);
    }
    return map;
  }

  private present(p: Prisma.PatientGetPayload<{ include: { responsible: { select: { id: true; name: true } } } }>, summary?: Summary, fullCpf = false) {
    const cpf = p.cpfEncrypted ? this.crypto.decrypt(p.cpfEncrypted) : null;
    return {
      id: p.id,
      code: patientCode(p.code),
      name: p.name,
      socialName: p.socialName,
      cpf: fullCpf ? formatCpf(cpf) : maskCpf(cpf),
      birthDate: dateOnly(p.birthDate),
      age: ageFrom(p.birthDate),
      sex: p.sex,
      phone: p.phone,
      whatsapp: p.whatsapp,
      email: p.email,
      photoUrl: p.photoUrl,
      profession: p.profession,
      addressLine: p.addressLine,
      city: p.city,
      state: p.state,
      zipCode: p.zipCode,
      emergencyContactName: p.emergencyContactName,
      emergencyContactPhone: p.emergencyContactPhone,
      source: p.source,
      crmStage: p.crmStage,
      responsible: p.responsible,
      lastContactAt: p.lastContactAt,
      notes: p.notes,
      createdAt: p.createdAt,
      ...(summary ?? {}),
    };
  }

  async list(ctx: RequestContext, q: ListPatientsQuery) {
    const where: Prisma.PatientWhereInput = { AND: [patientScope(ctx)] };
    const and = where.AND as Prisma.PatientWhereInput[];
    if (q.stage) and.push({ crmStage: q.stage });
    if (q.responsibleId) and.push({ responsibleId: q.responsibleId });
    if (q.search) and.push(this.searchWhere(q.search));
    const { skip, take, page, pageSize } = paginate(q.page, q.pageSize);
    const orderBy: Prisma.PatientOrderByWithRelationInput =
      q.sort === 'recent' ? { createdAt: 'desc' } : q.sort === 'code' ? { code: 'asc' } : { name: 'asc' };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.patient.count({ where }),
      this.prisma.patient.findMany({ where, orderBy, skip, take, include: { responsible: { select: { id: true, name: true } } } }),
    ]);
    const sums = await this.summaries(rows.map((r) => r.id));
    return { total, page, pageSize, items: rows.map((r) => ({ ...this.present(r, sums.get(r.id)), photoUrl: r.photoUrl })) };
  }

  /** Busca por nome, telefone, e-mail, código (P-0042 ou 42) ou CPF completo. */
  searchWhere(term: string): Prisma.PatientWhereInput {
    const t = term.trim();
    const d = digits(t);
    const or: Prisma.PatientWhereInput[] = [
      { name: { contains: t, mode: 'insensitive' } },
      { socialName: { contains: t, mode: 'insensitive' } },
      { email: { contains: t, mode: 'insensitive' } },
    ];
    if (d.length === 11) or.push({ cpfHash: this.crypto.cpfLookupHash(d) });
    if (d.length >= 4) or.push({ phoneDigits: { contains: d } });
    const code = /^p-?(\d+)$/i.exec(t)?.[1] ?? (/^\d{1,6}$/.test(t) ? t : null);
    if (code) or.push({ code: Number(code) });
    return { OR: or };
  }

  async get(ctx: RequestContext, id: string) {
    const p = await this.prisma.patient.findFirst({
      where: { AND: [patientScope(ctx), { id }] },
      include: { responsible: { select: { id: true, name: true } }, lead: { select: { id: true, firstContactAt: true, source: true } } },
    });
    if (!p) notFound('Paciente');
    const sums = await this.summaries([p.id]);
    await this.audit.recordRead(ctx, 'patient', p.id, `Ficha de ${p.name} consultada`);
    return { ...this.present(p, sums.get(p.id), true), lead: p.lead, canSeeClinical: can(ctx, 'clinical.read') };
  }

  /** Garante que o paciente existe e está no escopo do usuário. */
  async assertAccess(ctx: RequestContext, id: string) {
    const p = await this.prisma.patient.findFirst({ where: { AND: [patientScope(ctx), { id }] }, select: { id: true, name: true } });
    if (!p) notFound('Paciente');
    return p;
  }

  // ───────────────────────── escrita ─────────────────────────

  private async data(ctx: RequestContext, dto: UpdatePatientDto) {
    if (dto.responsibleId) {
      const ok = await this.prisma.user.count({ where: { id: dto.responsibleId, organizationId: ctx.user.organizationId, isActive: true } });
      if (!ok) throw new BadRequestException('Profissional responsável inválido');
    }
    const { cpf, birthDate, healthDataConsent: _c, ...rest } = dto;
    const data: Prisma.PatientUncheckedUpdateInput = { ...rest };
    if (cpf !== undefined) Object.assign(data, cpf ? this.crypto.protectCpf(cpf) : { cpfEncrypted: null, cpfHash: null });
    if (birthDate !== undefined) data.birthDate = toDate(birthDate);
    return data;
  }

  /** Próximo código sequencial por clínica, dentro da transação. */
  private async nextCode(tx: Tx, organizationId: string) {
    const max = await tx.patient.aggregate({ where: { organizationId }, _max: { code: true } });
    return (max._max.code ?? 0) + 1;
  }

  async create(ctx: RequestContext, dto: PatientDto, tx?: Tx, opts: { leadId?: string } = {}) {
    const run = async (t: Tx) => {
      const data = await this.data(ctx, dto);
      if (!dto.responsibleId && ctx.user.permissions.includes('clinical.write')) data.responsibleId = ctx.user.id;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const code = await this.nextCode(t, ctx.user.organizationId);
          const p = await t.patient.create({
            data: {
              ...(data as Prisma.PatientUncheckedCreateInput),
              name: dto.name,
              organizationId: ctx.user.organizationId,
              code,
              createdById: ctx.user.id,
              lastContactAt: new Date(),
              phoneDigits: phoneDigitsOf(dto.phone, dto.whatsapp),
            },
          });
          if (dto.healthDataConsent) {
            await t.consent.create({
              data: {
                organizationId: ctx.user.organizationId,
                patientId: p.id,
                purpose: ConsentPurpose.HEALTH_DATA_TREATMENT,
                termVersion: '1.0',
                channel: 'cadastro',
                evidence: { registeredBy: ctx.user.id, leadId: opts.leadId ?? null },
              },
            });
          }
          await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'patient', entityId: p.id, summary: `Paciente ${p.name} (${patientCode(code)}) cadastrado` }, t);
          return p;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const target = String((e.meta as { target?: unknown })?.target ?? '');
            if (target.includes('cpf')) throw new ConflictException('Já existe um paciente com este CPF');
            continue; // corrida no código sequencial: tenta o próximo
          }
          throw e;
        }
      }
      throw new ConflictException('Não foi possível gerar o código do paciente. Tente novamente.');
    };
    const p = tx ? await run(tx) : await this.prisma.$transaction(run);
    return p;
  }

  async createAndGet(ctx: RequestContext, dto: PatientDto) {
    const p = await this.create(ctx, dto);
    return this.get(ctx, p.id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdatePatientDto) {
    await this.assertAccess(ctx, id);
    const before = await this.prisma.patient.findUniqueOrThrow({ where: { id } });
    const data = await this.data(ctx, dto);
    try {
      const after = await this.prisma.$transaction(async (tx) => {
        let a = await tx.patient.update({ where: { id }, data: { ...data, updatedById: ctx.user.id } });
        a = await tx.patient.update({ where: { id }, data: { phoneDigits: phoneDigitsOf(a.phone, a.whatsapp) } });
        const changes = AuditService.diff(
          { ...before, photoUrl: before.photoUrl ? 'foto' : null, cpf: before.cpfHash ? 'informado' : null },
          { ...a, photoUrl: a.photoUrl ? 'foto' : null, cpf: a.cpfHash !== before.cpfHash ? (a.cpfHash ? 'alterado' : null) : before.cpfHash ? 'informado' : null },
        );
        delete changes.phoneDigits;
        delete changes.updatedById;
        if (Object.keys(changes).length) {
          await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'patient', entityId: id, summary: `Cadastro de ${a.name} atualizado`, changes }, tx);
        }
        return a;
      });
      return this.get(ctx, after.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Já existe um paciente com este CPF');
      throw e;
    }
  }

  async setStage(ctx: RequestContext, id: string, stage: string) {
    if (!(stage in PATIENT_STAGE_LABELS)) throw new BadRequestException('Etapa inválida');
    const p = await this.assertAccess(ctx, id);
    const before = await this.prisma.patient.findUniqueOrThrow({ where: { id }, select: { crmStage: true } });
    if (before.crmStage === stage) return { id, crmStage: stage };
    await this.prisma.$transaction(async (tx) => {
      await tx.patient.update({ where: { id }, data: { crmStage: stage as PatientStage, updatedById: ctx.user.id } });
      await this.audit.record(
        ctx,
        {
          action: AuditAction.UPDATE,
          entity: 'patient',
          entityId: id,
          summary: `${p.name}: ${PATIENT_STAGE_LABELS[before.crmStage]} → ${PATIENT_STAGE_LABELS[stage as PatientStage]}`,
          changes: { crmStage: { from: before.crmStage, to: stage } },
          metadata: { kind: 'stage' },
        },
        tx,
      );
    });
    return { id, crmStage: stage };
  }

  async remove(ctx: RequestContext, id: string) {
    const p = await this.assertAccess(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.patient.update({ where: { id }, data: { deletedAt: new Date(), updatedById: ctx.user.id } });
      await this.audit.record(ctx, { action: AuditAction.DELETE, entity: 'patient', entityId: id, summary: `Paciente ${p.name} excluído (exclusão lógica — histórico preservado)` }, tx);
    });
  }

  // ───────────────────────── linha do tempo ─────────────────────────

  async timeline(ctx: RequestContext, id: string) {
    const p = await this.assertAccess(ctx, id);
    const clinical = can(ctx, 'clinical.read');
    const finance = can(ctx, 'finance.read');
    const [patient, stageLogs, appts, evals, plans, sessions, payments, messages] = await Promise.all([
      this.prisma.patient.findUniqueOrThrow({ where: { id }, include: { lead: true } }),
      this.prisma.auditLog.findMany({
        where: { organizationId: ctx.user.organizationId, entity: 'patient', entityId: id, action: AuditAction.UPDATE, metadata: { path: ['kind'], equals: 'stage' } },
        select: { createdAt: true, summary: true, actorName: true },
      }),
      this.prisma.appointment.findMany({
        where: { patientId: id },
        select: { id: true, startsAt: true, status: true, createdAt: true, service: { select: { name: true, kind: true } }, professional: { select: { name: true } } },
      }),
      clinical ? this.prisma.evaluation.findMany({ where: { patientId: id, deletedAt: null }, select: { id: true, performedAt: true, type: true, professional: { select: { name: true } } } }) : [],
      clinical ? this.prisma.treatmentPlan.findMany({ where: { patientId: id }, select: { id: true, createdAt: true, objective: true, status: true } }) : [],
      this.prisma.treatmentSession.findMany({ where: { patientId: id }, select: { id: true, performedAt: true, sessionNumber: true, professional: { select: { name: true } } } }),
      finance ? this.prisma.payment.findMany({ where: { patientId: id, paidAt: { not: null } }, select: { id: true, paidAt: true, paidCents: true, description: true } }) : [],
      this.prisma.message.count({ where: { conversation: { patientId: id } } }),
    ]);

    type Ev = { at: Date; type: string; title: string; detail?: string | null; refId?: string };
    const ev: Ev[] = [];
    if (patient.lead) {
      ev.push({ at: patient.lead.firstContactAt, type: 'first_contact', title: `Primeiro contato${patient.lead.source === 'WHATSAPP' ? ' pelo WhatsApp' : ''}`, detail: patient.lead.reason });
      if (patient.lead.convertedAt) ev.push({ at: patient.lead.convertedAt, type: 'converted', title: 'Lead convertido em paciente' });
    } else {
      ev.push({ at: patient.createdAt, type: 'created', title: 'Paciente cadastrado' });
    }
    for (const s of stageLogs) ev.push({ at: s.createdAt, type: 'stage', title: s.summary?.split(': ').slice(1).join(': ') ?? 'Etapa alterada', detail: s.actorName });
    const apptLabels: Record<string, string> = {
      SCHEDULED: 'agendada', CONFIRMED: 'confirmada', IN_PROGRESS: 'em atendimento', DONE: 'realizada', CANCELLED: 'cancelada', NO_SHOW: 'falta', RESCHEDULED: 'reagendada', BLOCKED: 'bloqueio',
    };
    for (const a of appts) {
      if (a.status === 'DONE' && a.service?.kind !== 'EVALUATION') continue; // a sessão realizada aparece como "Sessão NN"
      const what = a.service?.kind === 'EVALUATION' ? 'Avaliação' : a.service?.name ?? 'Consulta';
      if (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') {
        ev.push({ at: a.createdAt, type: 'appointment_scheduled', title: `${what} agendada para ${a.startsAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, detail: a.professional.name, refId: a.id });
      } else {
        ev.push({ at: a.startsAt, type: `appointment_${a.status.toLowerCase()}`, title: `${what} ${apptLabels[a.status]}`, detail: a.professional.name, refId: a.id });
      }
    }
    for (const e of evals) ev.push({ at: e.performedAt, type: 'evaluation', title: e.type === 'INITIAL' ? 'Avaliação inicial realizada' : e.type === 'DISCHARGE' ? 'Avaliação de alta' : 'Reavaliação realizada', detail: e.professional.name, refId: e.id });
    for (const pl of plans) ev.push({ at: pl.createdAt, type: 'plan', title: 'Plano de tratamento criado', detail: pl.objective, refId: pl.id });
    for (const s of sessions) ev.push({ at: s.performedAt, type: 'session', title: `Sessão ${String(s.sessionNumber).padStart(2, '0')}`, detail: s.professional.name, refId: s.id });
    for (const pay of payments) ev.push({ at: pay.paidAt!, type: 'payment', title: `Pagamento recebido: R$ ${(pay.paidCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, detail: pay.description, refId: pay.id });
    ev.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { patientId: p.id, messages, events: ev };
  }
}

export const phoneDigitsOf = (...phones: (string | null | undefined)[]) =>
  phones.map((p) => digits(p)).filter(Boolean).join(' ') || null;

export interface Summary {
  nextAppointment: { startsAt: Date; service: string | null } | null;
  lastSessionAt: Date | null;
  sessionsDone: number;
  activePackage: { id: string; name: string; contracted: number; used: number; remaining: number; totalPriceCents: number } | null;
  balanceDueCents: number;
}
