/**
 * Seed de DEMONSTRAÇÃO. Cria uma clínica fictícia claramente identificada, com um usuário por perfil.
 * Não usar em produção. Execute: npm run db:seed
 */
import { PrismaClient, ServiceKind } from '@prisma/client';
import * as argon2 from 'argon2';
import { syncPermissionCatalog } from '../src/common/permission-sync.service';
import { ProvisioningService } from '../src/modules/organization/provisioning.service';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Demo@2026';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Seed de demonstração bloqueado em produção');
  await syncPermissionCatalog(prisma);

  const exists = await prisma.user.findFirst({ where: { email: 'admin@demo.fisiocrm.local' } });
  if (exists) {
    console.log('Clínica de demonstração já existe — nada a fazer.');
    return;
  }

  const hash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    const { organization, unit, roleIds } = await new ProvisioningService().createOrganization(tx, {
      organizationName: 'Clínica Demonstração',
      adminName: 'Administrador Demo',
      adminEmail: 'admin@demo.fisiocrm.local',
      passwordHash: hash,
    });
    const orgId = organization.id;

    await tx.user.create({
      data: {
        organizationId: orgId, roleId: roleIds.PHYSIO, name: 'Fisioterapeuta Demo', email: 'fisio@demo.fisiocrm.local',
        passwordHash: hash, passwordChangedAt: new Date(),
        userUnits: { create: { unitId: unit.id } },
        professional: { create: { crefito: 'DEMO-0000', specialties: ['Ortopedia'], calendarColor: '#2563eb' } },
      },
    });
    await tx.user.create({
      data: {
        organizationId: orgId, roleId: roleIds.RECEPTION, name: 'Recepção Demo', email: 'recepcao@demo.fisiocrm.local',
        passwordHash: hash, passwordChangedAt: new Date(), userUnits: { create: { unitId: unit.id } },
      },
    });

    await tx.businessSettings.update({
      where: { organizationId: orgId },
      data: {
        phone: '(00) 0000-0000', defaultSessionPriceCents: 12000, defaultSessionMinutes: 50,
        onboardingCompletedAt: new Date(), onboardingStep: 9,
      },
    });
    await tx.service.createMany({
      data: [
        { organizationId: orgId, name: 'Avaliação inicial', kind: ServiceKind.EVALUATION, durationMinutes: 60, priceCents: 15000 },
        { organizationId: orgId, name: 'Sessão de fisioterapia', kind: ServiceKind.SESSION, durationMinutes: 50, priceCents: 12000 },
      ],
    });
    const hours = [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, startTime: '08:00', endTime: '12:00' },
      { weekday, startTime: '14:00', endTime: '18:00' },
    ]);
    await tx.availabilityRule.createMany({ data: hours.map((h) => ({ ...h, organizationId: orgId, unitId: unit.id })) });
  });

  console.log(`
Clínica de demonstração criada. Senha de todos: ${DEMO_PASSWORD}
  admin@demo.fisiocrm.local     (Administrador)
  fisio@demo.fisiocrm.local     (Fisioterapeuta)
  recepcao@demo.fisiocrm.local  (Recepção)
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
