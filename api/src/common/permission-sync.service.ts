import { Global, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PERMISSION_CATALOG } from './permissions';

/**
 * Mantém a tabela `permissions` igual ao catálogo do código a cada inicialização.
 * Permissões novas também são adicionadas automaticamente ao papel ADMIN de todas as organizações.
 */
@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Permissions');
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await syncPermissionCatalog(this.prisma);
    this.logger.log(`${PERMISSION_CATALOG.length} permissões sincronizadas`);
  }
}

export async function syncPermissionCatalog(prisma: PrismaService | import('@prisma/client').PrismaClient) {
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: p,
      update: { module: p.module, description: p.description },
    });
  }
  const adminRoles = await prisma.role.findMany({ where: { key: 'ADMIN' }, select: { id: true } });
  if (adminRoles.length) {
    await prisma.rolePermission.createMany({
      data: adminRoles.flatMap((r) => PERMISSION_CATALOG.map((p) => ({ roleId: r.id, permissionCode: p.code }))),
      skipDuplicates: true,
    });
  }
}

@Global()
@Module({ providers: [PermissionSyncService] })
export class PermissionSyncModule {}
