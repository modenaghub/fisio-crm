import { Controller, Get, Global, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { PrismaService } from '../../common/prisma.service';
import { Ctx } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { effectivePermissions, type PermissionCode } from '../../common/permissions';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Destinatários: usuários específicos e/ou todos os ativos que tenham uma permissão. */
export interface NotifyTarget {
  userIds?: (string | null | undefined)[];
  permission?: PermissionCode;
  exceptUserId?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async usersWithPermission(organizationId: string, permission: PermissionCode) {
    const users = await this.prisma.user.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, role: { select: { permissions: { select: { permissionCode: true } } } }, permissionOverrides: true },
    });
    return users.filter((u) => effectivePermissions(u.role.permissions.map((p) => p.permissionCode), u.permissionOverrides).includes(permission)).map((u) => u.id);
  }

  async notify(organizationId: string, target: NotifyTarget, n: NotifyInput) {
    const ids = new Set((target.userIds ?? []).filter((x): x is string => !!x));
    if (target.permission) for (const id of await this.usersWithPermission(organizationId, target.permission)) ids.add(id);
    if (target.exceptUserId) ids.delete(target.exceptUserId);
    if (!ids.size) return 0;
    const r = await this.prisma.notification.createMany({
      data: [...ids].map((userId) => ({ organizationId, userId, type: n.type, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, link: n.link ?? null })),
    });
    return r.count;
  }

  async list(ctx: RequestContext, onlyUnread: boolean) {
    const where: Prisma.NotificationWhereInput = { userId: ctx.user.id, ...(onlyUnread ? { readAt: null } : {}) };
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
    ]);
    return { items, unread };
  }

  async read(ctx: RequestContext, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: ctx.user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async readAll(ctx: RequestContext) {
    const r = await this.prisma.notification.updateMany({ where: { userId: ctx.user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}

class ListQuery {
  @IsOptional() @IsIn(['1', 'true', '0', 'false'])
  unread?: string;
}

/** Central de notificações do usuário logado (não exige permissão: cada um vê só as suas). */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext, @Query() q: ListQuery) {
    return this.notifications.list(ctx, q.unread === '1' || q.unread === 'true');
  }

  @Post('read-all')
  readAll(@Ctx() ctx: RequestContext) {
    return this.notifications.readAll(ctx);
  }

  @Post(':id/read')
  read(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.read(ctx, id);
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
