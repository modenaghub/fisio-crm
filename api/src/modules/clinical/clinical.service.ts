import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { AppointmentStatus, AuditAction, PatientStage, Prisma, TreatmentPlanStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { RequestContext } from '../../common/auth/auth.types';
import { can, dateOnly, notFound, patientScope, toDate } from '../../common/helpers';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../finance/billing.service';
import {
  ClinicalProfileDto,
  ConditionDto,
  EditEvolutionDto,
  EvaluationDto,
  RegisterSessionDto,
  TreatmentPlanDto,
  UpdateConditionDto,
  UpdateEvaluationDto,
  UpdateTreatmentPlanDto,
} from './clinical.dto';

type Tx = Prisma.TransactionClient;

const EVOLUTION_FIELDS = ['complaint', 'patientState', 'painScale', 'procedures', 'exercises', 'techniques', 'treatmentResponse', 'evolutionText', 'guidance', 'nextSteps'] as const;

@Injectable()
export class ClinicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  /** Paciente no escopo do usuário; registra o acesso ao prontuário (LGPD). */
  private async patient(ctx: RequestContext, patientId: string, logRead?: string) {
    const p = await this.prisma.patient.findFirst({ where: { AND: [patientScope(ctx), { id: patientId }] }, select: { id: true, name: true, crmStage: true } });
    if (!p) notFound('Paciente');
    if (logRead) await this.audit.recordRead(ctx, 'clinical_record', p.id, `Prontuário de ${p.name} consultado (${logRead})`);
    return p;
  }

  // ───────────────────────── dados clínicos ─────────────────────────

  async getProfile(ctx: RequestContext, patientId: string) {
    await this.patient(ctx, patientId, 'dados clínicos');
    const [profile, conditions] = await Promise.all([
      this.prisma.clinicalProfile.findUnique({ where: { patientId } }),
      this.prisma.patientCondition.findMany({ where: { patientId }, orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }], include: { condition: { select: { icd10Code: true } } } }),
    ]);
    return {
      profile: profile ?? { patientId, mainComplaint: null, diagnosis: null, medicalHistory: null, medications: null, allergies: null, contraindications: null, observations: null, updatedAt: null },
      conditions: conditions.map((c) => ({ ...c, since: dateOnly(c.since), icd10Code: c.condition?.icd10Code ?? null, condition: undefined })),
    };
  }

  async saveProfile(ctx: RequestContext, patientId: string, dto: ClinicalProfileDto) {
    const p = await this.patient(ctx, patientId);
    const before = await this.prisma.clinicalProfile.findUnique({ where: { patientId } });
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.clinicalProfile.upsert({
        where: { patientId },
        create: { patientId, ...dto, updatedById: ctx.user.id },
        update: { ...dto, updatedById: ctx.user.id },
      });
      const changes = AuditService.diff(before, after);
      delete changes.updatedById;
      if (Object.keys(changes).length) {
        await this.audit.record(ctx, { action: before ? AuditAction.UPDATE : AuditAction.CREATE, entity: 'clinical_profile', entityId: patientId, summary: `Dados clínicos de ${p.name} atualizados`, changes }, tx);
      }
    });
    return this.getProfile(ctx, patientId);
  }

  async conditionsCatalog(ctx: RequestContext, q?: string) {
    return this.prisma.medicalCondition.findMany({
      where: { organizationId: ctx.user.organizationId, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  private async catalogId(tx: Tx, orgId: string, dto: Partial<ConditionDto>) {
    if (!dto.description || !dto.type) return undefined;
    const c = await tx.medicalCondition.upsert({
      where: { organizationId_name_type: { organizationId: orgId, name: dto.description, type: dto.type } },
      create: { organizationId: orgId, name: dto.description, type: dto.type, icd10Code: dto.icd10Code ?? null },
      update: dto.icd10Code ? { icd10Code: dto.icd10Code } : {},
    });
    return c.id;
  }

  async addCondition(ctx: RequestContext, patientId: string, dto: ConditionDto) {
    const p = await this.patient(ctx, patientId);
    return this.prisma.$transaction(async (tx) => {
      const conditionId = await this.catalogId(tx, ctx.user.organizationId, dto);
      const { icd10Code: _i, since, ...rest } = dto;
      const c = await tx.patientCondition.create({ data: { ...rest, since: toDate(since), patientId, conditionId, createdById: ctx.user.id } });
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'patient_condition', entityId: c.id, summary: `${p.name}: condição registrada — ${dto.description}` }, tx);
      return c;
    });
  }

  async updateCondition(ctx: RequestContext, patientId: string, id: string, dto: UpdateConditionDto) {
    const p = await this.patient(ctx, patientId);
    const before = await this.prisma.patientCondition.findFirst({ where: { id, patientId } });
    if (!before) notFound('Condição');
    return this.prisma.$transaction(async (tx) => {
      const conditionId = dto.description ? await this.catalogId(tx, ctx.user.organizationId, { ...before, ...dto } as ConditionDto) : undefined;
      const { icd10Code: _i, since, ...rest } = dto;
      const after = await tx.patientCondition.update({ where: { id }, data: { ...rest, ...(since !== undefined ? { since: toDate(since) } : {}), ...(conditionId ? { conditionId } : {}) } });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'patient_condition', entityId: id, summary: `${p.name}: condição atualizada — ${after.description}`, changes: AuditService.diff(before, after) }, tx);
      return after;
    });
  }

  async removeCondition(ctx: RequestContext, patientId: string, id: string) {
    if (!can(ctx, 'clinical.delete')) throw new ForbiddenException('Somente o administrador pode excluir registros clínicos. Marque a condição como inativa.');
    const p = await this.patient(ctx, patientId);
    const c = await this.prisma.patientCondition.findFirst({ where: { id, patientId } });
    if (!c) notFound('Condição');
    await this.prisma.$transaction(async (tx) => {
      await tx.patientCondition.delete({ where: { id } });
      await this.audit.record(ctx, { action: AuditAction.DELETE, entity: 'patient_condition', entityId: id, summary: `${p.name}: condição excluída — ${c.description}`, metadata: { removed: c } as never }, tx);
    });
  }

  // ───────────────────────── avaliações ─────────────────────────

  private evalData(dto: UpdateEvaluationDto) {
    const { mobility, posture, functionalAssessment, otherParams, performedAt, appointmentId: _a, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (performedAt) data.performedAt = new Date(performedAt);
    if (mobility !== undefined || posture !== undefined || functionalAssessment !== undefined) data.mobility = { text: mobility ?? null, posture: posture ?? null, functional: functionalAssessment ?? null };
    if (otherParams !== undefined) data.otherParams = { text: otherParams };
    for (const k of ['rangeOfMotion', 'strength', 'tests', 'scales'] as const) if (dto[k] !== undefined) data[k] = dto[k] as unknown as Prisma.InputJsonValue;
    return data;
  }

  private presentEval(e: Prisma.EvaluationGetPayload<{ include: { professional: { select: { id: true; name: true } } } }>) {
    const mob = (e.mobility ?? {}) as { text?: string; posture?: string; functional?: string };
    return {
      id: e.id, type: e.type, performedAt: e.performedAt, painScale: e.painScale, mainComplaint: e.mainComplaint,
      mobility: mob.text ?? null, posture: mob.posture ?? null, functionalAssessment: mob.functional ?? null,
      rangeOfMotion: e.rangeOfMotion ?? [], strength: e.strength ?? [], tests: e.tests ?? [], scales: e.scales ?? [],
      otherParams: (e.otherParams as { text?: string } | null)?.text ?? null, conclusion: e.conclusion,
      professional: e.professional, appointmentId: e.appointmentId, createdAt: e.createdAt, updatedAt: e.updatedAt,
    };
  }

  async listEvaluations(ctx: RequestContext, patientId: string) {
    await this.patient(ctx, patientId, 'avaliações');
    const rows = await this.prisma.evaluation.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { performedAt: 'desc' },
      include: { professional: { select: { id: true, name: true } } },
    });
    return rows.map((r) => this.presentEval(r));
  }

  async createEvaluation(ctx: RequestContext, patientId: string, dto: EvaluationDto) {
    const p = await this.patient(ctx, patientId);
    if (dto.appointmentId) await this.assertAppointment(ctx, patientId, dto.appointmentId);
    const e = await this.prisma.$transaction(async (tx) => {
      const created = await tx.evaluation.create({
        data: {
          ...(this.evalData(dto) as Prisma.EvaluationUncheckedCreateInput),
          organizationId: ctx.user.organizationId,
          patientId,
          professionalId: ctx.user.id,
          appointmentId: dto.appointmentId ?? null,
          type: dto.type,
          performedAt: new Date(dto.performedAt),
        },
        include: { professional: { select: { id: true, name: true } } },
      });
      if (dto.appointmentId) {
        const appt = await tx.appointment.update({ where: { id: dto.appointmentId }, data: { status: AppointmentStatus.DONE }, include: { service: { select: { kind: true, name: true } } } });
        await tx.appointmentStatusHistory.create({ data: { appointmentId: dto.appointmentId, toStatus: AppointmentStatus.DONE, changedById: ctx.user.id, channel: 'avaliação' } });
        await this.billing.chargeAppointment(tx, ctx, appt, p.name);
      }
      // Avaliação inicial feita: o lead, se houver, avança no funil.
      if (dto.type === 'INITIAL') {
        await tx.lead.updateMany({ where: { patientId, stage: { in: ['NEW_CONTACT', 'FIRST_SERVICE', 'DATA_COLLECTED', 'EVALUATION_SCHEDULED'] } }, data: { stage: 'EVALUATION_DONE' } });
      }
      await tx.patient.update({ where: { id: patientId }, data: { lastContactAt: new Date() } });
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'evaluation', entityId: created.id, summary: `${p.name}: ${dto.type === 'INITIAL' ? 'avaliação inicial' : dto.type === 'DISCHARGE' ? 'avaliação de alta' : 'reavaliação'} registrada` }, tx);
      return created;
    });
    return this.presentEval(e);
  }

  private async assertEditable(ctx: RequestContext, authorId: string) {
    if (authorId !== ctx.user.id && !can(ctx, 'clinical.delete')) {
      throw new ForbiddenException('Somente quem registrou (ou o administrador) pode alterar este registro');
    }
  }

  async updateEvaluation(ctx: RequestContext, patientId: string, id: string, dto: UpdateEvaluationDto) {
    const p = await this.patient(ctx, patientId);
    const before = await this.prisma.evaluation.findFirst({ where: { id, patientId, deletedAt: null } });
    if (!before) notFound('Avaliação');
    await this.assertEditable(ctx, before.professionalId);
    const e = await this.prisma.$transaction(async (tx) => {
      const after = await tx.evaluation.update({ where: { id }, data: this.evalData(dto), include: { professional: { select: { id: true, name: true } } } });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'evaluation', entityId: id, summary: `${p.name}: avaliação alterada`, changes: AuditService.diff(before, after) }, tx);
      return after;
    });
    return this.presentEval(e);
  }

  async deleteEvaluation(ctx: RequestContext, patientId: string, id: string, reason: string) {
    if (!can(ctx, 'clinical.delete')) throw new ForbiddenException('Somente o administrador pode excluir registros clínicos');
    const p = await this.patient(ctx, patientId);
    const e = await this.prisma.evaluation.findFirst({ where: { id, patientId, deletedAt: null } });
    if (!e) notFound('Avaliação');
    await this.prisma.$transaction(async (tx) => {
      await tx.evaluation.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(ctx, { action: AuditAction.DELETE, entity: 'evaluation', entityId: id, summary: `${p.name}: avaliação excluída — motivo: ${reason}`, metadata: { reason } }, tx);
    });
  }

  // ───────────────────────── plano de tratamento ─────────────────────────

  private presentPlan(pl: Prisma.TreatmentPlanGetPayload<{ include: { _count: { select: { sessions: true } } } }>) {
    return { ...pl, startDate: dateOnly(pl.startDate), expectedEndDate: dateOnly(pl.expectedEndDate), sessionsDone: pl._count.sessions, _count: undefined };
  }

  async listPlans(ctx: RequestContext, patientId: string) {
    await this.patient(ctx, patientId, 'plano de tratamento');
    const plans = await this.prisma.treatmentPlan.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { sessions: true } } } });
    return plans.map((pl) => this.presentPlan(pl));
  }

  async createPlan(ctx: RequestContext, patientId: string, dto: TreatmentPlanDto) {
    const p = await this.patient(ctx, patientId);
    if (dto.evaluationId) {
      const ok = await this.prisma.evaluation.count({ where: { id: dto.evaluationId, patientId } });
      if (!ok) throw new BadRequestException('Avaliação inválida');
    }
    this.checkDates(dto);
    const pl = await this.prisma.$transaction(async (tx) => {
      // Um plano ativo por vez: o anterior é concluído.
      if ((dto.status ?? 'ACTIVE') === 'ACTIVE') {
        await tx.treatmentPlan.updateMany({ where: { patientId, status: TreatmentPlanStatus.ACTIVE }, data: { status: TreatmentPlanStatus.COMPLETED } });
      }
      const created = await tx.treatmentPlan.create({
        data: {
          ...dto,
          startDate: toDate(dto.startDate) ?? new Date(new Date().toISOString().slice(0, 10)),
          expectedEndDate: toDate(dto.expectedEndDate),
          organizationId: ctx.user.organizationId,
          patientId,
          createdById: ctx.user.id,
        },
        include: { _count: { select: { sessions: true } } },
      });
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'treatment_plan', entityId: created.id, summary: `${p.name}: plano de tratamento criado` }, tx);
      return created;
    });
    return this.presentPlan(pl);
  }

  private checkDates(dto: UpdateTreatmentPlanDto) {
    if (dto.startDate && dto.expectedEndDate && dto.expectedEndDate < dto.startDate) {
      throw new BadRequestException('A previsão de término deve ser depois do início');
    }
  }

  async updatePlan(ctx: RequestContext, patientId: string, id: string, dto: UpdateTreatmentPlanDto) {
    const p = await this.patient(ctx, patientId);
    const before = await this.prisma.treatmentPlan.findFirst({ where: { id, patientId } });
    if (!before) notFound('Plano');
    this.checkDates({ startDate: dto.startDate ?? dateOnly(before.startDate), expectedEndDate: dto.expectedEndDate ?? dateOnly(before.expectedEndDate) });
    const pl = await this.prisma.$transaction(async (tx) => {
      if (dto.status === 'ACTIVE' && before.status !== 'ACTIVE') {
        await tx.treatmentPlan.updateMany({ where: { patientId, status: TreatmentPlanStatus.ACTIVE }, data: { status: TreatmentPlanStatus.COMPLETED } });
      }
      const { startDate, expectedEndDate, ...rest } = dto;
      const after = await tx.treatmentPlan.update({
        where: { id },
        data: { ...rest, ...(startDate !== undefined ? { startDate: toDate(startDate) } : {}), ...(expectedEndDate !== undefined ? { expectedEndDate: toDate(expectedEndDate) } : {}) },
        include: { _count: { select: { sessions: true } } },
      });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'treatment_plan', entityId: id, summary: `${p.name}: plano de tratamento atualizado`, changes: AuditService.diff(before, { ...after, _count: undefined }) }, tx);
      return after;
    });
    return this.presentPlan(pl);
  }

  // ───────────────────────── sessões e evoluções ─────────────────────────

  private async assertAppointment(ctx: RequestContext, patientId: string, appointmentId: string) {
    const a = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId: ctx.user.organizationId, patientId },
      include: { service: { select: { kind: true, name: true } }, treatmentSession: { select: { id: true } } },
    });
    if (!a) throw new BadRequestException('Agendamento inválido para este paciente');
    if (a.status === 'CANCELLED' || a.status === 'NO_SHOW' || a.status === 'RESCHEDULED') throw new BadRequestException('Este agendamento foi cancelado, reagendado ou marcado como falta');
    return a;
  }

  /**
   * Registra o atendimento. Numa única transação:
   * cria a sessão numerada → evolução (versão 1) → agendamento "Realizado" → desconto no pacote ou conta a receber
   * → status do paciente → auditoria.
   */
  async registerSession(ctx: RequestContext, patientId: string, dto: RegisterSessionDto) {
    const p = await this.patient(ctx, patientId);
    const appt = dto.appointmentId ? await this.assertAppointment(ctx, patientId, dto.appointmentId) : null;
    if (appt?.treatmentSession) throw new ConflictException('Este agendamento já tem um atendimento registrado');
    if (dto.treatmentPlanId) {
      const ok = await this.prisma.treatmentPlan.count({ where: { id: dto.treatmentPlanId, patientId } });
      if (!ok) throw new BadRequestException('Plano de tratamento inválido');
    }
    const performedAt = dto.performedAt ? new Date(dto.performedAt) : appt?.startsAt ?? new Date();
    if (performedAt.getTime() > Date.now() + 60 * 60_000) throw new BadRequestException('Não é possível registrar um atendimento no futuro');

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const last = await tx.treatmentSession.aggregate({ where: { patientId }, _max: { sessionNumber: true } });
          const sessionNumber = (last._max.sessionNumber ?? 0) + 1;
          const plan = dto.treatmentPlanId ?? (await tx.treatmentPlan.findFirst({ where: { patientId, status: 'ACTIVE' }, select: { id: true } }))?.id ?? null;
          const session = await tx.treatmentSession.create({
            data: {
              organizationId: ctx.user.organizationId,
              patientId,
              professionalId: ctx.user.id,
              appointmentId: appt?.id ?? null,
              treatmentPlanId: plan,
              sessionNumber,
              performedAt,
              durationMinutes: dto.durationMinutes ?? (appt ? Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000) : null),
            },
          });
          const content = Object.fromEntries(EVOLUTION_FIELDS.map((k) => [k, dto[k] ?? null]));
          await tx.sessionEvolution.create({
            data: {
              organizationId: ctx.user.organizationId,
              sessionId: session.id,
              currentVersion: 1,
              versions: { create: { ...(content as { evolutionText: string }), version: 1, authorId: ctx.user.id } },
            },
          });
          if (appt) {
            await tx.appointment.update({ where: { id: appt.id }, data: { status: AppointmentStatus.DONE } });
            await tx.appointmentStatusHistory.create({ data: { appointmentId: appt.id, fromStatus: appt.status, toStatus: AppointmentStatus.DONE, changedById: ctx.user.id, channel: 'atendimento' } });
          }
          const billing = dto.skipBilling
            ? { packageId: null, remaining: null, paymentId: null }
            : await this.billing.onSessionPerformed(tx, ctx, { patientId, patientName: p.name, sessionId: session.id, sessionNumber, performedAt, unitId: appt?.unitId, appointment: appt });
          const stageUpdate: PatientStage | undefined = ['TREATMENT_STARTED', 'ACTIVE', 'INACTIVE', 'REACTIVATION'].includes(p.crmStage) ? PatientStage.IN_TREATMENT : undefined;
          await tx.patient.update({ where: { id: patientId }, data: { lastContactAt: new Date(), ...(stageUpdate ? { crmStage: stageUpdate } : {}) } });
          await this.audit.record(
            ctx,
            { action: AuditAction.CREATE, entity: 'treatment_session', entityId: session.id, summary: `${p.name}: sessão ${String(sessionNumber).padStart(2, '0')} registrada`, metadata: { ...billing, appointmentId: appt?.id ?? null } },
            tx,
          );
          return { id: session.id, sessionNumber, performedAt, billing };
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 2) continue;
        throw e;
      }
    }
    throw new ConflictException('Não foi possível numerar a sessão. Tente novamente.');
  }

  private async sessionsQuery(where: Prisma.TreatmentSessionWhereInput, take = 200) {
    const rows = await this.prisma.treatmentSession.findMany({
      where,
      orderBy: { performedAt: 'desc' },
      take,
      include: {
        professional: { select: { id: true, name: true } },
        patient: { select: { id: true, name: true, photoUrl: true } },
        appointment: { select: { id: true, service: { select: { name: true } } } },
        packageUsage: { select: { reversedAt: true, package: { select: { name: true } } } },
        evolution: { include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { author: { select: { id: true, name: true } } } } } },
      },
    });
    return rows.map((s) => {
      const v = s.evolution?.versions[0];
      return {
        id: s.id,
        sessionNumber: s.sessionNumber,
        performedAt: s.performedAt,
        durationMinutes: s.durationMinutes,
        professional: s.professional,
        patient: s.patient,
        service: s.appointment?.service?.name ?? null,
        package: s.packageUsage && !s.packageUsage.reversedAt ? s.packageUsage.package.name : null,
        deleted: !!s.evolution?.deletedAt,
        deleteReason: s.evolution?.deleteReason ?? null,
        version: s.evolution?.currentVersion ?? 0,
        lastEditedBy: v?.author ?? null,
        lastEditedAt: v?.createdAt ?? null,
        content: s.evolution?.deletedAt ? null : v ? Object.fromEntries(EVOLUTION_FIELDS.map((k) => [k, v[k]])) : null,
      };
    });
  }

  async listSessions(ctx: RequestContext, patientId: string) {
    await this.patient(ctx, patientId, 'evoluções');
    return this.sessionsQuery({ patientId });
  }

  /** Atendimentos recentes (tela "Atendimentos"). Sem `patients.read_all`, só os do próprio profissional. */
  async recentSessions(ctx: RequestContext, q: { from?: string; to?: string; professionalId?: string }) {
    const where: Prisma.TreatmentSessionWhereInput = { organizationId: ctx.user.organizationId, patient: { AND: [patientScope(ctx)] } };
    if (q.professionalId) where.professionalId = q.professionalId;
    if (q.from || q.to) where.performedAt = { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined };
    return this.sessionsQuery(where, 100);
  }

  private async session(ctx: RequestContext, id: string) {
    const s = await this.prisma.treatmentSession.findFirst({
      where: { id, organizationId: ctx.user.organizationId, patient: { AND: [patientScope(ctx)] } },
      include: { evolution: true, patient: { select: { id: true, name: true } } },
    });
    if (!s || !s.evolution) notFound('Sessão');
    return s as typeof s & { evolution: NonNullable<typeof s.evolution> };
  }

  /** Editar cria uma nova versão; o texto anterior continua guardado. */
  async editEvolution(ctx: RequestContext, sessionId: string, dto: EditEvolutionDto) {
    const s = await this.session(ctx, sessionId);
    if (s.evolution.deletedAt) throw new BadRequestException('Esta evolução foi excluída');
    await this.assertEditable(ctx, s.professionalId);
    const version = s.evolution.currentVersion + 1;
    await this.prisma.$transaction(async (tx) => {
      const previous = await tx.sessionEvolutionVersion.findFirstOrThrow({ where: { evolutionId: s.evolution.id }, orderBy: { version: 'desc' } });
      const { editReason, ...content } = dto;
      const data = Object.fromEntries(EVOLUTION_FIELDS.map((k) => [k, content[k] ?? null])) as Record<string, unknown>;
      await tx.sessionEvolutionVersion.create({ data: { ...(data as { evolutionText: string }), evolutionId: s.evolution.id, version, editReason, authorId: ctx.user.id } });
      await tx.sessionEvolution.update({ where: { id: s.evolution.id }, data: { currentVersion: version } });
      const changes = Object.fromEntries(
        EVOLUTION_FIELDS.filter((k) => (previous[k] ?? null) !== (data[k] ?? null)).map((k) => [k, { from: previous[k], to: data[k] }]),
      );
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'session_evolution', entityId: sessionId, summary: `${s.patient.name}: evolução da sessão ${String(s.sessionNumber).padStart(2, '0')} alterada (versão ${version}) — ${editReason}`, changes }, tx);
    });
    return (await this.sessionsQuery({ id: sessionId }))[0];
  }

  async versions(ctx: RequestContext, sessionId: string) {
    const s = await this.session(ctx, sessionId);
    await this.audit.recordRead(ctx, 'clinical_record', s.patient.id, `Prontuário de ${s.patient.name} consultado (histórico de versões)`);
    const versions = await this.prisma.sessionEvolutionVersion.findMany({
      where: { evolutionId: s.evolution.id },
      orderBy: { version: 'desc' },
      include: { author: { select: { id: true, name: true } } },
    });
    return versions;
  }

  /** Exclusão lógica (somente administrador, com motivo). As versões permanecem no banco. */
  async deleteSession(ctx: RequestContext, sessionId: string, reason: string) {
    if (!can(ctx, 'clinical.delete')) throw new ForbiddenException('Somente o administrador pode excluir registros clínicos');
    const s = await this.session(ctx, sessionId);
    if (s.evolution.deletedAt) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.sessionEvolution.update({ where: { id: s.evolution.id }, data: { deletedAt: new Date(), deletedById: ctx.user.id, deleteReason: reason } });
      await this.billing.reverseSession(tx, sessionId);
      await this.audit.record(ctx, { action: AuditAction.DELETE, entity: 'session_evolution', entityId: sessionId, summary: `${s.patient.name}: sessão ${String(s.sessionNumber).padStart(2, '0')} excluída — motivo: ${reason}`, metadata: { reason } }, tx);
    });
  }

  /** Visão geral para a tela "Prontuários". */
  async overview(ctx: RequestContext, search?: string) {
    const where: Prisma.PatientWhereInput = { AND: [patientScope(ctx), ...(search ? [{ name: { contains: search, mode: 'insensitive' as const } }] : [])] };
    const patients = await this.prisma.patient.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, name: true, photoUrl: true, crmStage: true,
        clinicalProfile: { select: { mainComplaint: true, diagnosis: true } },
        evaluations: { where: { deletedAt: null }, orderBy: { performedAt: 'desc' }, take: 1, select: { performedAt: true, painScale: true, type: true } },
        treatmentPlans: { where: { status: 'ACTIVE' }, take: 1, select: { objective: true, plannedSessions: true } },
        treatmentSessions: { orderBy: { performedAt: 'desc' }, take: 1, select: { performedAt: true, sessionNumber: true } },
        _count: { select: { treatmentSessions: true, conditions: { where: { isActive: true } } } },
      },
    });
    return patients.map((p) => ({
      id: p.id, name: p.name, photoUrl: p.photoUrl, crmStage: p.crmStage,
      mainComplaint: p.clinicalProfile?.mainComplaint ?? null, diagnosis: p.clinicalProfile?.diagnosis ?? null,
      lastEvaluation: p.evaluations[0] ?? null, activePlan: p.treatmentPlans[0] ?? null,
      lastSession: p.treatmentSessions[0] ?? null, sessions: p._count.treatmentSessions, activeConditions: p._count.conditions,
    }));
  }
}
