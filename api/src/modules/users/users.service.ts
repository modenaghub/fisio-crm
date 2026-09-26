import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { effectivePermissions } from '../../common/permissions';
import type { RequestContext } from '../../common/auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto, ListUsersQuery, SetOverridesDto, UpdateUserDto } from './users.dto';

const userInclude = {
  role: { select: { id: true, key: true, name: true, permissions: { select: { permissionCode: true } } } },
  professional: true,
  userUnits: { include: { unit: { select: { id: true, name: true } } } },
  permissionOverrides: { select: { permissionCode: true, granted: true } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function present(u: UserWithRelations) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    avatarUrl: u.avatarUrl,
    isActive: u.isActive,
    isLocked: !!u.lockedUntil && u.lockedUntil > new Date(),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    role: { id: u.role.id, key: u.role.key, name: u.role.name },
    professional: u.professional
      ? { crefito: u.professional.crefito, specialties: u.professional.specialties, calendarColor: u.professional.calendarColor }
      : null,
    units: u.userUnits.map((x) => x.unit),
    overrides: u.permissionOverrides,
    permissions: effectivePermissions(u.role.permissions.map((p) => p.permissionCode), u.permissionOverrides),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(ctx: RequestContext, q: ListUsersQuery) {
    const where: Prisma.UserWhereInput = { organizationId: ctx.user.organizationId };
    if (q.status === 'active' || !q.status) where.isActive = true;
    if (q.status === 'inactive') where.isActive = false;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const users = await this.prisma.user.findMany({ where, include: userInclude, orderBy: { name: 'asc' } });
    return users.map(present);
  }

  async get(ctx: RequestContext, id: string) {
    return present(await this.find(ctx, id));
  }

  private async find(ctx: RequestContext, id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
      include: userInclude,
    });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    return u;
  }

  private async assertRole(ctx: RequestContext, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: ctx.user.organizationId } });
    if (!role) throw new BadRequestException('Perfil de acesso inválido');
    return role;
  }

  private async assertUnits(ctx: RequestContext, unitIds: string[]) {
    const count = await this.prisma.unit.count({ where: { id: { in: unitIds }, organizationId: ctx.user.organizationId } });
    if (count !== unitIds.length) throw new BadRequestException('Unidade inválida');
  }

  /** Nunca deixar a clínica sem nenhum administrador ativo. */
  private async assertKeepsAnAdmin(ctx: RequestContext, userId: string) {
    const others = await this.prisma.user.count({
      where: { organizationId: ctx.user.organizationId, isActive: true, role: { key: 'ADMIN' }, NOT: { id: userId } },
    });
    if (others === 0) throw new BadRequestException('A clínica precisa de ao menos um administrador ativo');
  }

  async create(ctx: RequestContext, dto: CreateUserDto) {
    await this.assertRole(ctx, dto.roleId);
    let unitIds = dto.unitIds;
    if (unitIds?.length) await this.assertUnits(ctx, unitIds);
    else {
      const first = await this.prisma.unit.findFirst({ where: { organizationId: ctx.user.organizationId }, orderBy: { createdAt: 'asc' } });
      unitIds = first ? [first.id] : [];
    }

    // Sem senha informada: senha aleatória inutilizável + convite por e-mail.
    const passwordHash = await this.crypto.hashPassword(dto.password ?? this.crypto.randomToken());
    let user: UserWithRelations;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            organizationId: ctx.user.organizationId,
            roleId: dto.roleId,
            name: dto.name,
            email: dto.email,
            phone: dto.phone,
            passwordHash,
            passwordChangedAt: dto.password ? new Date() : null,
            createdById: ctx.user.id,
            userUnits: { createMany: { data: unitIds!.map((unitId) => ({ unitId })) } },
            professional: dto.isProfessional
              ? { create: { crefito: dto.crefito, specialties: dto.specialties ?? [] } }
              : undefined,
          },
          include: userInclude,
        });
        await this.audit.record(
          ctx,
          {
            action: AuditAction.CREATE,
            entity: 'user',
            entityId: created.id,
            summary: `Usuário ${created.name} criado com perfil ${created.role.name}`,
          },
          tx,
        );
        return created;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Já existe um usuário com este e-mail nesta clínica');
      }
      throw e;
    }

    if (!dto.password) {
      await this.auth.sendPasswordLink(user, 'invite', { ip: ctx.ip, userAgent: ctx.userAgent }, ctx);
    }
    return { ...present(user), invited: !dto.password };
  }

  async update(ctx: RequestContext, id: string, dto: UpdateUserDto) {
    const before = await this.find(ctx, id);

    if (dto.roleId && dto.roleId !== before.roleId) {
      if (id === ctx.user.id) throw new BadRequestException('Você não pode alterar o seu próprio perfil de acesso');
      await this.assertRole(ctx, dto.roleId);
      if (before.role.key === 'ADMIN') await this.assertKeepsAnAdmin(ctx, id);
    }
    if (dto.unitIds) {
      if (!dto.unitIds.length) throw new BadRequestException('Selecione ao menos uma unidade');
      await this.assertUnits(ctx, dto.unitIds);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { name: dto.name, email: dto.email, phone: dto.phone, roleId: dto.roleId },
        });
        if (dto.unitIds) {
          await tx.userUnit.deleteMany({ where: { userId: id } });
          await tx.userUnit.createMany({ data: dto.unitIds.map((unitId) => ({ userId: id, unitId })) });
        }
        const profData = { crefito: dto.crefito, specialties: dto.specialties, calendarColor: dto.calendarColor };
        if (dto.isProfessional === false && before.professional) {
          await tx.professionalProfile.delete({ where: { userId: id } });
        } else if (dto.isProfessional || before.professional) {
          await tx.professionalProfile.upsert({
            where: { userId: id },
            create: { userId: id, crefito: dto.crefito, specialties: dto.specialties ?? [], calendarColor: dto.calendarColor },
            update: profData,
          });
        }
        const after = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
        const changes = AuditService.diff(
          { ...flat(before) },
          { ...flat(after) },
        );
        if (Object.keys(changes).length) {
          await this.audit.record(
            ctx,
            {
              action: dto.roleId && dto.roleId !== before.roleId ? AuditAction.PERMISSION_CHANGE : AuditAction.UPDATE,
              entity: 'user',
              entityId: id,
              summary: `Usuário ${after.name} atualizado`,
              changes,
            },
            tx,
          );
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Já existe um usuário com este e-mail nesta clínica');
      }
      throw e;
    }
    return this.get(ctx, id);
  }

  async setActive(ctx: RequestContext, id: string, isActive: boolean) {
    const user = await this.find(ctx, id);
    if (id === ctx.user.id && !isActive) throw new BadRequestException('Você não pode desativar o seu próprio usuário');
    if (!isActive && user.role.key === 'ADMIN') await this.assertKeepsAnAdmin(ctx, id);
    if (user.isActive === isActive) return present(user);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive, lockedUntil: null, failedLoginCount: 0 } });
      if (!isActive) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: 'user_deactivated' },
        });
      }
      await this.audit.record(
        ctx,
        {
          action: AuditAction.UPDATE,
          entity: 'user',
          entityId: id,
          summary: isActive ? `Usuário ${user.name} reativado` : `Usuário ${user.name} desativado e desconectado`,
          changes: { isActive: { from: user.isActive, to: isActive } },
        },
        tx,
      );
    });
    return this.get(ctx, id);
  }

  async unlock(ctx: RequestContext, id: string) {
    const user = await this.find(ctx, id);
    await this.prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    await this.audit.record(ctx, { action: AuditAction.UPDATE, entity: 'user', entityId: id, summary: `Acesso de ${user.name} desbloqueado` });
    return this.get(ctx, id);
  }

  async setOverrides(ctx: RequestContext, id: string, dto: SetOverridesDto) {
    const user = await this.find(ctx, id);
    if (id === ctx.user.id) throw new BadRequestException('Você não pode alterar as suas próprias permissões');
    const unique = new Map(dto.overrides.map((o) => [o.permissionCode, o.granted]));
    await this.prisma.$transaction(async (tx) => {
      await tx.userPermissionOverride.deleteMany({ where: { userId: id } });
      if (unique.size) {
        await tx.userPermissionOverride.createMany({
          data: [...unique].map(([permissionCode, granted]) => ({ userId: id, permissionCode, granted, grantedById: ctx.user.id })),
        });
      }
      await this.audit.record(
        ctx,
        {
          action: AuditAction.PERMISSION_CHANGE,
          entity: 'user',
          entityId: id,
          summary: `Exceções de permissão de ${user.name} atualizadas`,
          changes: {
            overrides: {
              from: user.permissionOverrides,
              to: [...unique].map(([permissionCode, granted]) => ({ permissionCode, granted })),
            },
          },
        },
        tx,
      );
    });
    return this.get(ctx, id);
  }

  async sendAccessLink(ctx: RequestContext, id: string) {
    const user = await this.find(ctx, id);
    if (!user.isActive) throw new BadRequestException('Reative o usuário antes de enviar o link');
    const neverSetPassword = !user.passwordChangedAt;
    await this.auth.sendPasswordLink(user, neverSetPassword ? 'invite' : 'reset', { ip: ctx.ip, userAgent: ctx.userAgent }, ctx);
    return { sent: true, kind: neverSetPassword ? 'invite' : 'reset' };
  }
}

function flat(u: UserWithRelations) {
  return {
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role.name,
    units: u.userUnits.map((x) => x.unit.name).sort(),
    professional: !!u.professional,
    crefito: u.professional?.crefito ?? null,
    specialties: u.professional?.specialties ?? [],
    calendarColor: u.professional?.calendarColor ?? null,
  };
}
