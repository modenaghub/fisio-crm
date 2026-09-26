import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, LeadStage, PatientStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import type { RequestContext } from '../../common/auth/auth.types';
import { ageFrom, can, dateOnly, digits, maskCpf, notFound, patientCode, patientScope, toDate } from '../../common/helpers';
import { AuditService } from '../audit/audit.service';
import { ConvertLeadDto, LeadDto, UpdateLeadDto } from './crm.dto';
import { PATIENT_STAGE_LABELS, PatientsService } from './patients.service';

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW_CONTACT: 'Novo contato',
  FIRST_SERVICE: 'Primeiro atendimento',
  DATA_COLLECTED: 'Dados coletados',
  EVALUATION_SCHEDULED: 'Avaliação agendada',
  EVALUATION_DONE: 'Avaliação realizada',
  CONVERTED: 'Convertido',
  LOST: 'Perdido',
};

/** As 11 etapas do funil, na ordem da especificação. */
export const BOARD_COLUMNS: { key: string; label: string; kind: 'lead' | 'patient' }[] = [
  { key: 'NEW_CONTACT', label: 'Novo contato', kind: 'lead' },
  { key: 'FIRST_SERVICE', label: 'Primeiro atendimento', kind: 'lead' },
  { key: 'DATA_COLLECTED', label: 'Dados coletados', kind: 'lead' },
  { key: 'EVALUATION_SCHEDULED', label: 'Avaliação agendada', kind: 'lead' },
  { key: 'EVALUATION_DONE', label: 'Avaliação realizada', kind: 'lead' },
  { key: 'TREATMENT_STARTED', label: 'Tratamento iniciado', kind: 'patient' },
  { key: 'ACTIVE', label: 'Paciente ativo', kind: 'patient' },
  { key: 'IN_TREATMENT', label: 'Tratamento em andamento', kind: 'patient' },
  { key: 'DISCHARGED', label: 'Alta', kind: 'patient' },
  { key: 'INACTIVE', label: 'Paciente inativo', kind: 'patient' },
  { key: 'REACTIVATION', label: 'Reativação', kind: 'patient' },
];

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
  ) {}

  private scope(ctx: RequestContext): Prisma.LeadWhereInput {
    return { organizationId: ctx.user.organizationId, deletedAt: null };
  }

  private present(l: Prisma.LeadGetPayload<{ include: { responsible: { select: { id: true; name: true } } } }>) {
    const cpf = l.cpfEncrypted ? this.crypto.decrypt(l.cpfEncrypted) : null;
    return {
      id: l.id, name: l.name, phone: l.phone, email: l.email, cpf: maskCpf(cpf), birthDate: dateOnly(l.birthDate), age: ageFrom(l.birthDate),
      source: l.source, sourceDetail: l.sourceDetail, stage: l.stage, temperature: l.temperature, reason: l.reason, bodyRegion: l.bodyRegion,
      hasDiagnosis: l.hasDiagnosis, previousPhysio: l.previousPhysio, intakeAnswers: l.intakeAnswers, firstContactAt: l.firstContactAt,
      lastContactAt: l.lastContactAt, lostReason: l.lostReason, responsible: l.responsible, patientId: l.patientId, convertedAt: l.convertedAt,
      createdAt: l.createdAt,
    };
  }

  private async find(ctx: RequestContext, id: string) {
    const l = await this.prisma.lead.findFirst({ where: { ...this.scope(ctx), id }, include: { responsible: { select: { id: true, name: true } } } });
    if (!l) notFound('Lead');
    return l;
  }

  async list(ctx: RequestContext, q: { stage?: LeadStage; search?: string }) {
    const where: Prisma.LeadWhereInput = { ...this.scope(ctx) };
    if (q.stage) where.stage = q.stage;
    if (q.search) where.OR = this.searchOr(q.search);
    const rows = await this.prisma.lead.findMany({ where, orderBy: { firstContactAt: 'desc' }, take: 200, include: { responsible: { select: { id: true, name: true } } } });
    return rows.map((r) => this.present(r));
  }

  searchOr(term: string): Prisma.LeadWhereInput[] {
    const d = digits(term);
    const or: Prisma.LeadWhereInput[] = [{ name: { contains: term.trim(), mode: 'insensitive' } }, { email: { contains: term.trim(), mode: 'insensitive' } }];
    if (d.length >= 4) or.push({ phoneDigits: { contains: d } });
    if (d.length === 11) or.push({ cpfHash: this.crypto.cpfLookupHash(d) });
    return or;
  }

  async get(ctx: RequestContext, id: string) {
    return this.present(await this.find(ctx, id));
  }

  private async fields(ctx: RequestContext, dto: UpdateLeadDto) {
    if (dto.responsibleId) {
      const ok = await this.prisma.user.count({ where: { id: dto.responsibleId, organizationId: ctx.user.organizationId, isActive: true } });
      if (!ok) throw new BadRequestException('Responsável inválido');
    }
    const { cpf, birthDate, intakeAnswers, ...rest } = dto;
    const data: Prisma.LeadUncheckedUpdateInput = { ...rest };
    if (cpf !== undefined) Object.assign(data, cpf ? this.crypto.protectCpf(cpf) : { cpfEncrypted: null, cpfHash: null });
    if (birthDate !== undefined) data.birthDate = toDate(birthDate);
    if (dto.phone !== undefined) data.phoneDigits = digits(dto.phone);
    if (intakeAnswers !== undefined) data.intakeAnswers = intakeAnswers as Prisma.InputJsonValue;
    return data;
  }

  async create(ctx: RequestContext, dto: LeadDto) {
    const data = await this.fields(ctx, dto);
    const lead = await this.prisma.$transaction(async (tx) => {
      const l = await tx.lead.create({
        data: {
          ...(data as Prisma.LeadUncheckedCreateInput),
          name: dto.name,
          phone: dto.phone,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          responsibleId: dto.responsibleId ?? ctx.user.id,
          lastContactAt: new Date(),
        },
        include: { responsible: { select: { id: true, name: true } } },
      });
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'lead', entityId: l.id, summary: `Lead ${l.name} cadastrado` }, tx);
      return l;
    });
    return this.present(lead);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateLeadDto) {
    const before = await this.find(ctx, id);
    const data = await this.fields(ctx, dto);
    const after = await this.prisma.$transaction(async (tx) => {
      const a = await tx.lead.update({ where: { id }, data, include: { responsible: { select: { id: true, name: true } } } });
      const changes = AuditService.diff(before, a);
      delete changes.phoneDigits;
      delete changes.responsible;
      if (Object.keys(changes).length) await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'lead', entityId: id, summary: `Lead ${a.name} atualizado`, changes }, tx);
      return a;
    });
    return this.present(after);
  }

  async setStage(ctx: RequestContext, id: string, stage: string, position?: number) {
    if (!(stage in LEAD_STAGE_LABELS) || stage === 'CONVERTED') throw new BadRequestException('Para converter o lead em paciente, use "Converter em paciente"');
    const l = await this.find(ctx, id);
    if (l.stage === 'CONVERTED') throw new BadRequestException('Este lead já é paciente');
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { stage: stage as LeadStage, position: position ?? l.position, lastContactAt: new Date() } });
      if (l.stage !== stage) {
        await this.audit.record(
          ctx,
          { action: AuditAction.UPDATE, entity: 'lead', entityId: id, summary: `${l.name}: ${LEAD_STAGE_LABELS[l.stage]} → ${LEAD_STAGE_LABELS[stage as LeadStage]}`, changes: { stage: { from: l.stage, to: stage } }, metadata: { kind: 'stage' } },
          tx,
        );
      }
    });
    return { id, stage };
  }

  async markLost(ctx: RequestContext, id: string, reason: string) {
    const l = await this.find(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { stage: LeadStage.LOST, lostReason: reason } });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'lead', entityId: id, summary: `Lead ${l.name} marcado como perdido: ${reason}`, metadata: { kind: 'stage' } }, tx);
    });
    return { id, stage: 'LOST' };
  }

  async reopen(ctx: RequestContext, id: string) {
    const l = await this.find(ctx, id);
    if (l.stage !== 'LOST') throw new BadRequestException('O lead não está marcado como perdido');
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { stage: LeadStage.NEW_CONTACT, lostReason: null } });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'lead', entityId: id, summary: `Lead ${l.name} reaberto` }, tx);
    });
    return { id, stage: 'NEW_CONTACT' };
  }

  /** Lead → paciente: cria o paciente com os dados coletados e mantém o vínculo. */
  async convert(ctx: RequestContext, id: string, dto: ConvertLeadDto) {
    const l = await this.find(ctx, id);
    if (l.patientId) throw new BadRequestException('Este lead já foi convertido');
    const existingCpf = l.cpfEncrypted ? this.crypto.decrypt(l.cpfEncrypted) : null;
    const patient = await this.prisma.$transaction(async (tx) => {
      const p = await this.patients.create(
        ctx,
        {
          name: l.name,
          phone: l.phone,
          whatsapp: l.source === 'WHATSAPP' ? l.phone : undefined,
          email: l.email,
          cpf: dto.cpf ?? existingCpf,
          birthDate: dto.birthDate ?? dateOnly(l.birthDate),
          sex: dto.sex,
          source: l.source,
          crmStage: PatientStage.TREATMENT_STARTED,
          responsibleId: dto.responsibleId ?? l.responsibleId,
          healthDataConsent: dto.healthDataConsent,
          notes: l.reason ? `Motivo do contato: ${l.reason}` : undefined,
        },
        tx,
        { leadId: l.id },
      );
      await tx.lead.update({ where: { id }, data: { patientId: p.id, stage: LeadStage.CONVERTED, convertedAt: new Date() } });
      // Consentimentos dados como lead passam a valer para o paciente.
      await tx.consent.updateMany({ where: { leadId: id }, data: { patientId: p.id } });
      // Conversas já existentes (WhatsApp) passam a pertencer ao paciente.
      await tx.conversation.updateMany({ where: { leadId: id }, data: { patientId: p.id } });
      // Dados clínicos informados no primeiro contato viram o ponto de partida do prontuário.
      if (l.reason || l.bodyRegion || l.hasDiagnosis !== null) {
        await tx.clinicalProfile.create({
          data: {
            patientId: p.id,
            mainComplaint: [l.reason, l.bodyRegion ? `Região: ${l.bodyRegion}` : null].filter(Boolean).join(' — ') || null,
            observations: l.previousPhysio === null ? null : `Já realizou fisioterapia antes: ${l.previousPhysio ? 'sim' : 'não'}`,
            updatedById: ctx.user.id,
          },
        });
      }
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'lead', entityId: id, summary: `Lead ${l.name} convertido em paciente ${patientCode(p.code)}`, metadata: { kind: 'stage', patientId: p.id } }, tx);
      return p;
    });
    return { patientId: patient.id, code: patientCode(patient.code) };
  }

  async remove(ctx: RequestContext, id: string) {
    const l = await this.find(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(ctx, { action: AuditAction.DELETE, entity: 'lead', entityId: id, summary: `Lead ${l.name} excluído` }, tx);
    });
  }

  // ───────────────────────── Kanban ─────────────────────────

  async board(ctx: RequestContext, q: { search?: string; responsibleId?: string }) {
    const canLeads = can(ctx, 'leads.read');
    const clinical = can(ctx, 'clinical.read');
    const leadWhere: Prisma.LeadWhereInput = { ...this.scope(ctx), stage: { in: ['NEW_CONTACT', 'FIRST_SERVICE', 'DATA_COLLECTED', 'EVALUATION_SCHEDULED', 'EVALUATION_DONE'] } };
    const patientWhere: Prisma.PatientWhereInput = { AND: [patientScope(ctx)] };
    if (q.search) {
      leadWhere.OR = this.searchOr(q.search);
      (patientWhere.AND as Prisma.PatientWhereInput[]).push(this.patients.searchWhere(q.search));
    }
    if (q.responsibleId) {
      leadWhere.responsibleId = q.responsibleId;
      (patientWhere.AND as Prisma.PatientWhereInput[]).push({ responsibleId: q.responsibleId });
    }
    const [leads, patients, settings] = await Promise.all([
      canLeads
        ? this.prisma.lead.findMany({ where: leadWhere, orderBy: [{ position: 'asc' }, { firstContactAt: 'desc' }], take: 500, include: { responsible: { select: { id: true, name: true } } } })
        : [],
      this.prisma.patient.findMany({
        where: patientWhere,
        orderBy: { updatedAt: 'desc' },
        take: 600,
        include: {
          responsible: { select: { id: true, name: true } },
          treatmentPlans: clinical ? { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1, select: { objective: true, plannedSessions: true } } : false,
        },
      }),
      this.prisma.businessSettings.findUnique({ where: { organizationId: ctx.user.organizationId }, select: { defaultSessionPriceCents: true } }),
    ]);
    const sums = await this.patients.summaries(patients.map((p) => p.id));
    // Próxima avaliação agendada dos leads (agendamentos criados antes da conversão ficam na conversa/tarefa; aqui usamos o último contato).
    const cards: Record<string, unknown[]> = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.key, []]));
    for (const l of leads) {
      const cpf = l.cpfEncrypted ? this.crypto.decrypt(l.cpfEncrypted) : null;
      cards[l.stage]?.push({
        kind: 'lead', id: l.id, name: l.name, photoUrl: null, phone: l.phone, birthDate: dateOnly(l.birthDate), cpf: maskCpf(cpf),
        source: l.source, stage: l.stage, temperature: l.temperature, lastContactAt: l.lastContactAt ?? l.firstContactAt, nextAppointment: null,
        treatment: l.reason, sessionsDone: 0, sessionsRemaining: null, valueCents: null, responsible: l.responsible,
      });
    }
    for (const p of patients) {
      const s = sums.get(p.id)!;
      const cpf = p.cpfEncrypted ? this.crypto.decrypt(p.cpfEncrypted) : null;
      const plan = (p as unknown as { treatmentPlans?: { objective: string; plannedSessions: number | null }[] }).treatmentPlans?.[0];
      cards[p.crmStage]?.push({
        kind: 'patient', id: p.id, code: patientCode(p.code), name: p.name, photoUrl: p.photoUrl, phone: p.whatsapp ?? p.phone, birthDate: dateOnly(p.birthDate),
        cpf: maskCpf(cpf), source: p.source, stage: p.crmStage, lastContactAt: p.lastContactAt, nextAppointment: s.nextAppointment?.startsAt ?? null,
        treatment: plan?.objective ?? null, sessionsDone: s.sessionsDone,
        sessionsRemaining: s.activePackage?.remaining ?? (plan?.plannedSessions ? Math.max(0, plan.plannedSessions - s.sessionsDone) : null),
        valueCents: s.activePackage?.totalPriceCents ?? settings?.defaultSessionPriceCents ?? null, responsible: p.responsible,
      });
    }
    return {
      columns: BOARD_COLUMNS.filter((c) => canLeads || c.kind === 'patient').map((c) => ({ ...c, cards: cards[c.key] })),
      stageLabels: { ...LEAD_STAGE_LABELS, ...PATIENT_STAGE_LABELS },
    };
  }

  // ───────────────────────── busca global ─────────────────────────

  async search(ctx: RequestContext, term: string) {
    const [patients, leads] = await Promise.all([
      this.prisma.patient.findMany({
        where: { AND: [patientScope(ctx), this.patients.searchWhere(term)] },
        take: 8,
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, phone: true, whatsapp: true, email: true, crmStage: true, photoUrl: true, birthDate: true },
      }),
      can(ctx, 'leads.read')
        ? this.prisma.lead.findMany({
            where: { ...this.scope(ctx), patientId: null, OR: this.searchOr(term) },
            take: 5,
            orderBy: { firstContactAt: 'desc' },
            select: { id: true, name: true, phone: true, stage: true },
          })
        : [],
    ]);
    return {
      patients: patients.map((p) => ({ ...p, code: patientCode(p.code), age: ageFrom(p.birthDate), birthDate: undefined, stageLabel: PATIENT_STAGE_LABELS[p.crmStage] })),
      leads: leads.map((l) => ({ ...l, stageLabel: LEAD_STAGE_LABELS[l.stage] })),
    };
  }
}
