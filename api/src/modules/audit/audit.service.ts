import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { RequestContext } from '../../common/auth/auth.types';

/** Campos que nunca entram no log de auditoria. */
const REDACTED = new Set([
  'passwordHash',
  'password',
  'tokenHash',
  'cpfEncrypted',
  'cpfHash',
  'encryptedSecrets',
  'failedLoginCount',
  'updatedAt',
]);

export interface AuditEntry {
  organizationId: string;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary?: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
  actorName?: string | null;
  ip?: string;
  userAgent?: string;
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Calcula a diferença entre dois objetos, ignorando campos sensíveis. */
  static diff(before: Record<string, any> | null, after: Record<string, any> | null) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    for (const k of keys) {
      if (REDACTED.has(k)) continue;
      const a = before?.[k];
      const b = after?.[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = { from: a ?? null, to: b ?? null };
    }
    return changes;
  }

  /** Grava um registro. Aceita um cliente de transação para gravar junto com a alteração. */
  async log(entry: AuditEntry, tx: Tx = this.prisma) {
    await tx.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId ?? null,
        actorName: entry.actorName ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ip,
        userAgent: entry.userAgent?.slice(0, 500),
      },
    });
  }

  /**
   * Registra acesso de leitura (LGPD: quem consultou dados pessoais/clínicos).
   * Agrupa acessos repetidos do mesmo usuário ao mesmo registro em uma janela de 10 minutos.
   */
  async recordRead(ctx: RequestContext, entity: string, entityId: string, summary: string) {
    const recent = await this.prisma.auditLog.findFirst({
      where: {
        organizationId: ctx.user.organizationId,
        actorUserId: ctx.user.id,
        action: AuditAction.READ,
        entity,
        entityId,
        createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
      },
      select: { id: true },
    });
    if (recent) return;
    await this.record(ctx, { action: AuditAction.READ, entity, entityId, summary });
  }

  /** Atalho a partir do contexto da requisição. */
  record(
    ctx: RequestContext,
    data: Omit<AuditEntry, 'organizationId' | 'actorUserId' | 'actorName' | 'ip' | 'userAgent'>,
    tx?: Tx,
  ) {
    return this.log(
      {
        ...data,
        organizationId: ctx.user.organizationId,
        actorUserId: ctx.user.id || null,
        actorName: ctx.user.name,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      tx,
    );
  }
}
