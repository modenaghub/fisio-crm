import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, IntegrationProvider, IntegrationStatus, Prisma, ServiceKind } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../common/prisma.service';
import type { RequestContext } from '../../common/auth/auth.types';
import { AuditService } from '../audit/audit.service';
import {
  ClinicStepDto,
  ContactStepDto,
  FinanceStepDto,
  HoursStepDto,
  LogoStepDto,
  ONBOARDING_STEPS,
  OnboardingStep,
  PricingStepDto,
  ProfessionalStepDto,
  ServicesStepDto,
  UnitDto,
  UpdateSettingsDto,
  WhatsAppStepDto,
} from './organization.dto';

type Tx = Prisma.TransactionClient;

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private orgId(ctx: RequestContext) {
    return ctx.user.organizationId;
  }

  /** Unidade padrão do usuário (primeira vinculada) ou da organização. */
  private async primaryUnitId(ctx: RequestContext, tx: Tx | PrismaService = this.prisma) {
    const link = await tx.userUnit.findFirst({ where: { userId: ctx.user.id }, include: { unit: true } });
    if (link) return link.unitId;
    const unit = await tx.unit.findFirst({ where: { organizationId: this.orgId(ctx) }, orderBy: { createdAt: 'asc' } });
    if (!unit) throw new NotFoundException('Nenhuma unidade cadastrada');
    return unit.id;
  }

  // ───────── Configurações ─────────

  async getSettings(ctx: RequestContext) {
    const s = await this.prisma.businessSettings.findUniqueOrThrow({ where: { organizationId: this.orgId(ctx) } });
    return s;
  }

  async updateSettings(ctx: RequestContext, dto: UpdateSettingsDto) {
    const before = await this.getSettings(ctx);
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.businessSettings.update({ where: { organizationId: this.orgId(ctx) }, data: dto });
      if (dto.clinicName) await tx.organization.update({ where: { id: this.orgId(ctx) }, data: { name: dto.clinicName } });
      await this.audit.record(
        ctx,
        { action: AuditAction.UPDATE, entity: 'business_settings', entityId: this.orgId(ctx), summary: 'Configurações da clínica atualizadas', changes: AuditService.diff(before, updated) },
        tx,
      );
      return updated;
    });
    return after;
  }

  // ───────── Horários de atendimento ─────────

  async getHours(ctx: RequestContext) {
    const unitId = await this.primaryUnitId(ctx);
    const rules = await this.prisma.availabilityRule.findMany({
      where: { organizationId: this.orgId(ctx), unitId, professionalId: null },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
    return {
      unitId,
      days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        intervals: rules.filter((r) => r.weekday === weekday).map((r) => ({ start: r.startTime, end: r.endTime })),
      })),
    };
  }

  async saveHours(ctx: RequestContext, dto: HoursStepDto, tx: Tx) {
    const weekdays = new Set<number>();
    for (const day of dto.days) {
      if (weekdays.has(day.weekday)) throw new BadRequestException('Dia da semana repetido');
      weekdays.add(day.weekday);
      const sorted = [...day.intervals].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
      for (let i = 0; i < sorted.length; i++) {
        if (toMinutes(sorted[i].start) >= toMinutes(sorted[i].end)) {
          throw new BadRequestException(`Horário inválido: ${sorted[i].start}–${sorted[i].end} (início deve ser antes do fim)`);
        }
        if (i > 0 && toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
          throw new BadRequestException(`Horários sobrepostos: ${sorted[i - 1].start}–${sorted[i - 1].end} e ${sorted[i].start}–${sorted[i].end}`);
        }
      }
    }
    const total = dto.days.reduce((n, d) => n + d.intervals.length, 0);
    if (total === 0) throw new BadRequestException('Informe ao menos um horário de atendimento');

    const unitId = await this.primaryUnitId(ctx, tx);
    await tx.availabilityRule.deleteMany({ where: { organizationId: this.orgId(ctx), unitId, professionalId: null } });
    await tx.availabilityRule.createMany({
      data: dto.days.flatMap((d) =>
        d.intervals.map((i) => ({ organizationId: this.orgId(ctx), unitId, weekday: d.weekday, startTime: i.start, endTime: i.end })),
      ),
    });
    return { weeklyMinutes: dto.days.flatMap((d) => d.intervals).reduce((n, i) => n + toMinutes(i.end) - toMinutes(i.start), 0) };
  }

  // ───────── Serviços ─────────

  listServices(ctx: RequestContext) {
    return this.prisma.service.findMany({
      where: { organizationId: this.orgId(ctx), isActive: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  /** Substitui a lista: atualiza os existentes, cria os novos e desativa os removidos (preserva histórico). */
  async saveServices(ctx: RequestContext, dto: ServicesStepDto, tx: Tx) {
    const names = dto.services.map((s) => s.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new BadRequestException('Há serviços com o mesmo nome');
    const existing = await tx.service.findMany({ where: { organizationId: this.orgId(ctx) } });
    const existingIds = new Set(existing.map((s) => s.id));
    const keep = new Set<string>();
    for (const s of dto.services) {
      if (s.id) {
        if (!existingIds.has(s.id)) throw new BadRequestException('Serviço inválido');
        keep.add(s.id);
        await tx.service.update({
          where: { id: s.id },
          data: { name: s.name, kind: s.kind, durationMinutes: s.durationMinutes, priceCents: s.priceCents, isActive: true },
        });
      } else {
        const created = await tx.service.create({
          data: { organizationId: this.orgId(ctx), name: s.name, kind: s.kind, durationMinutes: s.durationMinutes, priceCents: s.priceCents },
        });
        keep.add(created.id);
      }
    }
    await tx.service.updateMany({
      where: { organizationId: this.orgId(ctx), id: { notIn: [...keep] } },
      data: { isActive: false },
    });
  }

  // ───────── Unidades ─────────

  listUnits(ctx: RequestContext) {
    return this.prisma.unit.findMany({ where: { organizationId: this.orgId(ctx) }, orderBy: { createdAt: 'asc' } });
  }

  async createUnit(ctx: RequestContext, dto: UnitDto) {
    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.unit.create({ data: { ...dto, organizationId: this.orgId(ctx) } });
      await this.audit.record(ctx, { action: AuditAction.CREATE, entity: 'unit', entityId: unit.id, summary: `Unidade "${unit.name}" criada` }, tx);
      return unit;
    });
  }

  async updateUnit(ctx: RequestContext, id: string, dto: UnitDto) {
    const before = await this.prisma.unit.findFirst({ where: { id, organizationId: this.orgId(ctx) } });
    if (!before) throw new NotFoundException('Unidade não encontrada');
    if (dto.isActive === false) {
      const active = await this.prisma.unit.count({ where: { organizationId: this.orgId(ctx), isActive: true } });
      if (active <= 1 && before.isActive) throw new BadRequestException('A clínica precisa de ao menos uma unidade ativa');
    }
    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.unit.update({ where: { id }, data: dto });
      await this.audit.record(
        ctx,
        { action: AuditAction.UPDATE, entity: 'unit', entityId: id, summary: `Unidade "${unit.name}" atualizada`, changes: AuditService.diff(before, unit) },
        tx,
      );
      return unit;
    });
  }

  // ───────── Onboarding (primeiro acesso) ─────────

  async getOnboarding(ctx: RequestContext) {
    const orgId = this.orgId(ctx);
    const [settings, user, hours, services, whatsapp, categories] = await Promise.all([
      this.getSettings(ctx),
      this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, include: { professional: true } }),
      this.getHours(ctx),
      this.listServices(ctx),
      this.prisma.integrationConfig.findUnique({ where: { organizationId_provider: { organizationId: orgId, provider: IntegrationProvider.WHATSAPP_CLOUD } } }),
      this.prisma.expenseCategory.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } }),
    ]);
    return {
      completed: !!settings.onboardingCompletedAt,
      currentStep: settings.onboardingStep,
      data: {
        1: { clinicName: settings.clinicName },
        2: { name: user.name, crefito: user.professional?.crefito ?? '', specialties: user.professional?.specialties ?? [] },
        3: { logoDataUrl: settings.logoUrl },
        4: { phone: settings.phone ?? '', email: settings.email ?? '', addressLine: settings.addressLine ?? '', city: settings.city ?? '', state: settings.state ?? '', zipCode: settings.zipCode ?? '' },
        5: hours,
        6: {
          defaultSessionPriceCents: settings.defaultSessionPriceCents,
          defaultSessionMinutes: settings.defaultSessionMinutes,
          evaluationPriceCents: services.find((s) => s.kind === ServiceKind.EVALUATION)?.priceCents ?? null,
        },
        7: { services },
        8: { whatsapp: settings.whatsapp ?? '', integrationStatus: whatsapp?.status ?? IntegrationStatus.NOT_CONFIGURED },
        9: { acceptedPaymentMethods: settings.acceptedPaymentMethods, expenseCategories: categories.map((c) => c.name) },
      },
    };
  }

  async saveOnboardingStep(ctx: RequestContext, step: number, body: unknown) {
    const Dto = ONBOARDING_STEPS[step as OnboardingStep];
    if (!Dto) throw new BadRequestException('Etapa inválida');
    const dto = plainToInstance(Dto as any, body ?? {});
    const errors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      const messages = errors.flatMap(function collect(e): string[] {
        return [...Object.values(e.constraints ?? {}), ...(e.children ?? []).flatMap(collect)];
      });
      throw new BadRequestException({ message: messages, error: 'Bad Request' });
    }
    const orgId = this.orgId(ctx);

    await this.prisma.$transaction(async (tx) => {
      switch (step) {
        case 1: {
          const d = dto as ClinicStepDto;
          await tx.businessSettings.update({ where: { organizationId: orgId }, data: { clinicName: d.clinicName } });
          await tx.organization.update({ where: { id: orgId }, data: { name: d.clinicName } });
          break;
        }
        case 2: {
          const d = dto as ProfessionalStepDto;
          await tx.user.update({ where: { id: ctx.user.id }, data: { name: d.name } });
          await tx.professionalProfile.upsert({
            where: { userId: ctx.user.id },
            create: { userId: ctx.user.id, crefito: d.crefito, specialties: d.specialties ?? [] },
            update: { crefito: d.crefito ?? null, specialties: d.specialties ?? [] },
          });
          break;
        }
        case 3: {
          const d = dto as LogoStepDto;
          await tx.businessSettings.update({ where: { organizationId: orgId }, data: { logoUrl: d.logoDataUrl } });
          break;
        }
        case 4: {
          const d = dto as ContactStepDto;
          await tx.businessSettings.update({ where: { organizationId: orgId }, data: { ...d } });
          break;
        }
        case 5:
          await this.saveHours(ctx, dto as HoursStepDto, tx);
          break;
        case 6: {
          const d = dto as PricingStepDto;
          await tx.businessSettings.update({
            where: { organizationId: orgId },
            data: { defaultSessionPriceCents: d.defaultSessionPriceCents, defaultSessionMinutes: d.defaultSessionMinutes },
          });
          // Garante os dois serviços básicos para a próxima etapa já vir preenchida.
          const upsertBasic = async (kind: ServiceKind, name: string, priceCents: number, durationMinutes: number) => {
            const found = await tx.service.findFirst({ where: { organizationId: orgId, kind, isActive: true } });
            if (found) await tx.service.update({ where: { id: found.id }, data: { priceCents, durationMinutes } });
            else await tx.service.create({ data: { organizationId: orgId, kind, name, priceCents, durationMinutes } });
          };
          await upsertBasic(ServiceKind.SESSION, 'Sessão de fisioterapia', d.defaultSessionPriceCents, d.defaultSessionMinutes);
          if (d.evaluationPriceCents != null) {
            await upsertBasic(ServiceKind.EVALUATION, 'Avaliação inicial', d.evaluationPriceCents, Math.max(d.defaultSessionMinutes, 60));
          }
          break;
        }
        case 7:
          await this.saveServices(ctx, dto as ServicesStepDto, tx);
          break;
        case 8: {
          const d = dto as WhatsAppStepDto;
          await tx.businessSettings.update({ where: { organizationId: orgId }, data: { whatsapp: d.whatsapp ?? null } });
          // Fica em modo demonstração até a conexão com a WhatsApp Business Platform (Fase 7).
          await tx.integrationConfig.upsert({
            where: { organizationId_provider: { organizationId: orgId, provider: IntegrationProvider.WHATSAPP_CLOUD } },
            create: { organizationId: orgId, provider: IntegrationProvider.WHATSAPP_CLOUD, status: d.whatsapp ? IntegrationStatus.MOCK : IntegrationStatus.NOT_CONFIGURED, publicConfig: { displayNumber: d.whatsapp ?? null } },
            update: { status: d.whatsapp ? IntegrationStatus.MOCK : IntegrationStatus.NOT_CONFIGURED, publicConfig: { displayNumber: d.whatsapp ?? null } },
          });
          break;
        }
        case 9: {
          const d = dto as FinanceStepDto;
          await tx.businessSettings.update({ where: { organizationId: orgId }, data: { acceptedPaymentMethods: [...new Set(d.acceptedPaymentMethods)] } });
          const wanted = [...new Set(d.expenseCategories.map((c) => c.trim()).filter(Boolean))];
          await tx.expenseCategory.createMany({ data: wanted.map((name) => ({ organizationId: orgId, name })), skipDuplicates: true });
          // Remove apenas categorias sem despesas lançadas.
          await tx.expenseCategory.deleteMany({ where: { organizationId: orgId, name: { notIn: wanted }, expenses: { none: {} } } });
          break;
        }
      }

      const settings = await tx.businessSettings.findUniqueOrThrow({ where: { organizationId: orgId } });
      await tx.businessSettings.update({ where: { organizationId: orgId }, data: { onboardingStep: Math.max(settings.onboardingStep, step) } });
      await this.audit.record(
        ctx,
        {
          action: AuditAction.UPDATE,
          entity: 'onboarding',
          entityId: orgId,
          summary: `Primeiro acesso: etapa ${step} salva`,
          // Não registra a imagem do logo inteira no log.
          metadata: step === 3 ? { logo: (dto as LogoStepDto).logoDataUrl ? 'enviado' : 'removido' } : (dto as object as Record<string, unknown>),
        },
        tx,
      );
    });

    return this.getOnboarding(ctx);
  }

  async completeOnboarding(ctx: RequestContext) {
    const orgId = this.orgId(ctx);
    const [settings, rules, services] = await Promise.all([
      this.getSettings(ctx),
      this.prisma.availabilityRule.count({ where: { organizationId: orgId } }),
      this.prisma.service.count({ where: { organizationId: orgId, isActive: true } }),
    ]);
    const missing: string[] = [];
    if (!settings.clinicName) missing.push('nome da clínica');
    if (rules === 0) missing.push('horários de atendimento');
    if (services === 0) missing.push('serviços e valores');
    if (missing.length) throw new BadRequestException(`Para concluir, preencha: ${missing.join(', ')}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.businessSettings.update({ where: { organizationId: orgId }, data: { onboardingCompletedAt: new Date(), onboardingStep: 9 } });
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'onboarding', entityId: orgId, summary: 'Configuração inicial concluída' }, tx);
    });
    return { completed: true };
  }

  // Salvamento avulso (tela de Configurações) reutiliza as mesmas regras do onboarding.
  async saveHoursStandalone(ctx: RequestContext, dto: HoursStepDto) {
    await this.prisma.$transaction(async (tx) => {
      await this.saveHours(ctx, dto, tx);
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'availability_rules', summary: 'Horários de atendimento atualizados', metadata: dto as unknown as Record<string, unknown> }, tx);
    });
    return this.getHours(ctx);
  }

  async saveServicesStandalone(ctx: RequestContext, dto: ServicesStepDto) {
    await this.prisma.$transaction(async (tx) => {
      await this.saveServices(ctx, dto, tx);
      await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'services', summary: 'Serviços e valores atualizados', metadata: dto as unknown as Record<string, unknown> }, tx);
    });
    return this.listServices(ctx);
  }
}
