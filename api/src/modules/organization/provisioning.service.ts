import { Injectable } from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { DEFAULT_EXPENSE_CATEGORIES, SYSTEM_ROLES } from '../../common/permissions';

/** Textos automáticos padrão (seção 13 da especificação). Editáveis em Configurações. */
export const DEFAULT_MESSAGE_TEMPLATES = [
  {
    key: 'welcome_bot',
    name: 'Boas-vindas (novo contato)',
    body: 'Olá! Seja bem-vindo(a) à {{clinica}}. Para realizarmos seu primeiro cadastro, precisamos de algumas informações.',
    buttons: [],
  },
  {
    key: 'reminder_24h',
    name: 'Lembrete 24 horas antes',
    body: 'Olá, {{paciente}}! Passando para confirmar sua sessão de fisioterapia amanhã às {{hora}}.',
    buttons: ['CONFIRMAR', 'REAGENDAR', 'CANCELAR'],
  },
  {
    key: 'reminder_2h',
    name: 'Lembrete 2 horas antes',
    body: 'Olá, {{paciente}}! Sua sessão está marcada para hoje às {{hora}}.',
    buttons: [],
  },
  {
    key: 'no_show',
    name: 'Após falta',
    body: 'Olá, {{paciente}}. Notamos que você não conseguiu comparecer à sua sessão. Deseja reagendar?',
    buttons: ['REAGENDAR'],
  },
  {
    key: 'post_session',
    name: 'Após atendimento',
    body: 'Olá, {{paciente}}! Sua sessão foi registrada. Caso tenha alguma dúvida ou desconforto, entre em contato conosco.',
    buttons: [],
  },
  {
    key: 'no_return',
    name: 'Paciente sem retorno',
    body: 'Olá, {{paciente}}! Notamos que faz alguns dias desde sua última sessão. Gostaria de verificar sua próxima disponibilidade?',
    buttons: ['AGENDAR'],
  },
];

function slugify(name: string) {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'clinica'
  );
}

/**
 * Cria uma organização (tenant) completa e pronta para uso:
 * unidade principal, papéis do sistema com permissões, configurações, categorias de despesa,
 * textos automáticos e o usuário administrador.
 */
@Injectable()
export class ProvisioningService {
  async createOrganization(
    tx: Prisma.TransactionClient,
    input: { organizationName: string; adminName: string; adminEmail: string; passwordHash: string },
  ) {
    const slug = `${slugify(input.organizationName)}-${Math.random().toString(36).slice(2, 7)}`;
    const org = await tx.organization.create({ data: { name: input.organizationName, slug } });
    const unit = await tx.unit.create({ data: { organizationId: org.id, name: 'Unidade principal' } });

    const roleIds: Record<string, string> = {};
    for (const r of SYSTEM_ROLES) {
      const role = await tx.role.create({
        data: {
          organizationId: org.id,
          key: r.key,
          name: r.name,
          description: r.description,
          isSystem: true,
          permissions: { createMany: { data: r.permissions.map((permissionCode) => ({ permissionCode })) } },
        },
      });
      roleIds[r.key] = role.id;
    }

    await tx.businessSettings.create({ data: { organizationId: org.id, clinicName: input.organizationName } });
    await tx.expenseCategory.createMany({
      data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ organizationId: org.id, name, isSystem: true })),
    });
    await tx.messageTemplate.createMany({
      data: DEFAULT_MESSAGE_TEMPLATES.map((t) => ({ ...t, organizationId: org.id, channel: Channel.WHATSAPP })),
    });

    const admin = await tx.user.create({
      data: {
        organizationId: org.id,
        roleId: roleIds.ADMIN,
        name: input.adminName,
        email: input.adminEmail,
        passwordHash: input.passwordHash,
        passwordChangedAt: new Date(),
        userUnits: { create: { unitId: unit.id } },
        // O administrador que abre a conta normalmente também atende: já nasce com perfil profissional.
        professional: { create: {} },
      },
    });

    return { organization: org, unit, admin, roleIds };
  }
}
