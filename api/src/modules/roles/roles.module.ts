import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../common/prisma.service';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { PERMISSION_CATALOG } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';

const CODES = PERMISSION_CATALOG.map((p) => p.code);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class RoleDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(60)
  name: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  description?: string;

  @IsArray() @ArrayUnique() @IsIn(CODES, { each: true, message: 'Permissão desconhecida' })
  permissions: string[];
}

class UpdateRoleDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(60)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  description?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(CODES, { each: true, message: 'Permissão desconhecida' })
  permissions?: string[];
}

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  catalog() {
    const modules = new Map<string, { code: string; description: string }[]>();
    for (const p of PERMISSION_CATALOG) {
      if (!modules.has(p.module)) modules.set(p.module, []);
      modules.get(p.module)!.push({ code: p.code, description: p.description });
    }
    return [...modules].map(([module, permissions]) => ({ module, permissions }));
  }

  async list(ctx: RequestContext) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId: ctx.user.organizationId },
      include: { permissions: true, _count: { select: { users: { where: { isActive: true } } } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isLocked: r.key === 'ADMIN',
      activeUsers: r._count.users,
      permissions: r.permissions.map((p) => p.permissionCode).sort(),
    }));
  }

  private async find(ctx: RequestContext, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Perfil não encontrado');
    return role;
  }

  async create(ctx: RequestContext, dto: RoleDto) {
    const key = `CUSTOM_${Date.now().toString(36).toUpperCase()}`;
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const r = await tx.role.create({
          data: {
            organizationId: ctx.user.organizationId,
            key,
            name: dto.name,
            description: dto.description,
            permissions: { createMany: { data: dto.permissions.map((permissionCode) => ({ permissionCode })) } },
          },
        });
        await this.audit.record(
          ctx,
          { action: AuditAction.CREATE, entity: 'role', entityId: r.id, summary: `Perfil "${r.name}" criado`, metadata: { permissions: dto.permissions } },
          tx,
        );
        return r;
      });
      return role;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Perfil já existe');
      throw e;
    }
  }

  async update(ctx: RequestContext, id: string, dto: UpdateRoleDto) {
    const role = await this.find(ctx, id);
    // O papel Administrador sempre tem todas as permissões — evita que a clínica perca o acesso de gestão.
    if (role.key === 'ADMIN' && dto.permissions) {
      throw new BadRequestException('As permissões do Administrador não podem ser alteradas');
    }
    const before = role.permissions.map((p) => p.permissionCode).sort();
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { name: dto.name, description: dto.description } });
      if (dto.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: dto.permissions.map((permissionCode) => ({ roleId: id, permissionCode })) });
      }
      const added = (dto.permissions ?? before).filter((p) => !before.includes(p));
      const removed = dto.permissions ? before.filter((p) => !dto.permissions!.includes(p)) : [];
      await this.audit.record(
        ctx,
        {
          action: AuditAction.PERMISSION_CHANGE,
          entity: 'role',
          entityId: id,
          summary: `Perfil "${dto.name ?? role.name}" atualizado`,
          changes: {
            ...(dto.name && dto.name !== role.name ? { name: { from: role.name, to: dto.name } } : {}),
            ...(added.length || removed.length ? { permissions: { from: removed, to: added } } : {}),
          },
          metadata: { added, removed },
        },
        tx,
      );
    });
    return (await this.list(ctx)).find((r) => r.id === id);
  }

  async remove(ctx: RequestContext, id: string) {
    const role = await this.find(ctx, id);
    if (role.isSystem) throw new BadRequestException('Perfis do sistema não podem ser excluídos');
    if (role._count.users > 0) throw new BadRequestException('Mova os usuários deste perfil antes de excluí-lo');
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.audit.record(ctx, { action: AuditAction.DELETE, entity: 'role', entityId: id, summary: `Perfil "${role.name}" excluído` }, tx);
    });
  }
}

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermissions('users.manage')
  @Get('permissions')
  catalog() {
    return this.roles.catalog();
  }

  @RequirePermissions('users.manage')
  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.roles.list(ctx);
  }

  @RequirePermissions('roles.manage')
  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: RoleDto) {
    return this.roles.create(ctx, dto);
  }

  @RequirePermissions('roles.manage')
  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(ctx, id, dto);
  }

  @RequirePermissions('roles.manage')
  @HttpCode(204)
  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(ctx, id);
  }
}

@Module({ controllers: [RolesController], providers: [RolesService] })
export class RolesModule {}
