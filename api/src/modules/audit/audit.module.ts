import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../../common/prisma.service';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { AuditService } from './audit.service';

class AuditQuery {
  @IsOptional() @IsString() @MaxLength(60) entity?: string;
  @IsOptional() @IsString() @MaxLength(80) entityId?: string;
  @IsOptional() @IsEnum(AuditAction) action?: AuditAction;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(100) pageSize = 25;
}

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext, q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = { organizationId: ctx.user.organizationId };
    if (q.entity) where.entity = q.entity;
    if (q.entityId) where.entityId = q.entityId;
    if (q.action) where.action = q.action;
    if (q.actorUserId) where.actorUserId = q.actorUserId;
    if (q.from || q.to) where.createdAt = { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined };
    if (q.search) where.OR = [{ summary: { contains: q.search, mode: 'insensitive' } }, { actorName: { contains: q.search, mode: 'insensitive' } }];

    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items };
  }

  async entities(ctx: RequestContext) {
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId: ctx.user.organizationId },
      distinct: ['entity'],
      select: { entity: true },
    });
    return rows.map((r) => r.entity).sort();
  }
}

@Controller('audit-logs')
@RequirePermissions('audit.view')
export class AuditController {
  constructor(private readonly q: AuditQueryService) {}

  @Get()
  list(@Ctx() ctx: RequestContext, @Query() query: AuditQuery) {
    return this.q.list(ctx, query);
  }

  @Get('entities')
  entities(@Ctx() ctx: RequestContext) {
    return this.q.entities(ctx);
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService, AuditQueryService], exports: [AuditService] })
export class AuditModule {}
