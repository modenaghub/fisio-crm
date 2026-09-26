import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { config } from '../../common/config';
import { effectivePermissions } from '../../common/permissions';
import type { AccessTokenPayload, RequestContext } from '../../common/auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { ProvisioningService } from '../organization/provisioning.service';
import { EMAIL_PROVIDER, EmailProvider } from '../../integrations/email/email.provider';
import { ChangePasswordDto, LoginDto, RegisterDto, ResetPasswordDto, UpdateProfileDto } from './auth.dto';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Janela em que um refresh token recém-rotacionado ainda é tolerado (abas simultâneas). */
const ROTATION_GRACE_MS = Number(process.env.AUTH_ROTATION_GRACE_MS ?? 15_000);

@Injectable()
export class AuthService {
  // Hash fixo usado para igualar o tempo de resposta quando o e-mail não existe.
  private dummyHash?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly provisioning: ProvisioningService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  // ───────────────────────── cadastro ─────────────────────────

  async register(dto: RegisterDto, meta: ClientMeta) {
    const passwordHash = await this.crypto.hashPassword(dto.password);
    const { organization, admin } = await this.prisma.$transaction(async (tx) => {
      const result = await this.provisioning.createOrganization(tx, {
        organizationName: dto.organizationName,
        adminName: dto.name,
        adminEmail: dto.email,
        passwordHash,
      });
      await this.audit.log(
        {
          organizationId: result.organization.id,
          actorUserId: result.admin.id,
          actorName: result.admin.name,
          action: AuditAction.CREATE,
          entity: 'organization',
          entityId: result.organization.id,
          summary: `Conta da clínica "${dto.organizationName}" criada`,
          metadata: { termsAcceptedAt: new Date().toISOString() },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
      await tx.user.update({ where: { id: result.admin.id }, data: { lastLoginAt: new Date() } });
      return result;
    });
    return this.issueSession(admin, meta, organization.id);
  }

  // ───────────────────────── login ─────────────────────────

  async login(dto: LoginDto, meta: ClientMeta) {
    const candidates = await this.prisma.user.findMany({
      where: {
        email: dto.email,
        isActive: true,
        organization: { isActive: true },
        ...(dto.organizationId ? { organizationId: dto.organizationId } : {}),
      },
      include: { organization: { select: { id: true, name: true } } },
    });

    if (candidates.length === 0) {
      this.dummyHash ??= await this.crypto.hashPassword('dummy-password-1');
      await this.crypto.verifyPassword(this.dummyHash, dto.password);
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }

    const now = new Date();
    const verified: typeof candidates = [];
    let lockedAny = false;

    for (const user of candidates) {
      if (user.lockedUntil && user.lockedUntil > now) {
        lockedAny = true;
        continue;
      }
      if (await this.crypto.verifyPassword(user.passwordHash, dto.password)) {
        verified.push(user);
        continue;
      }
      const failed = user.failedLoginCount + 1;
      const lock = failed >= config.maxFailedLogins;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(now.getTime() + config.lockMinutes * 60_000) : null,
        },
      });
      await this.audit.log({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorName: user.name,
        action: AuditAction.LOGIN_FAILED,
        entity: 'user',
        entityId: user.id,
        summary: lock ? `Conta bloqueada por ${config.lockMinutes} min após tentativas inválidas` : 'Senha incorreta',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      if (lock) lockedAny = true;
    }

    if (verified.length === 0) {
      if (lockedAny) {
        throw new HttpException(
          `Acesso bloqueado temporariamente por excesso de tentativas. Tente novamente em ${config.lockMinutes} minutos ou redefina sua senha.`,
          HttpStatus.LOCKED,
        );
      }
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }

    // Mesmo e-mail com senha válida em mais de uma clínica: o usuário escolhe.
    if (verified.length > 1) {
      return {
        requiresOrganization: true as const,
        organizations: verified.map((u) => ({ id: u.organization.id, name: u.organization.name })),
      };
    }

    const user = verified[0];
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorName: user.name,
      action: AuditAction.LOGIN,
      entity: 'user',
      entityId: user.id,
      summary: 'Login realizado',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.issueSession(user, meta, user.organizationId);
  }

  // ───────────────────────── sessões e tokens ─────────────────────────

  private async issueSession(user: Pick<User, 'id'>, meta: ClientMeta, organizationId: string, familyId?: string) {
    const refreshToken = this.crypto.randomToken();
    const refreshExpiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000);
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId: familyId ?? randomUUID(),
        tokenHash: this.crypto.sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ipAddress: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500),
      },
    });
    const payload: AccessTokenPayload = { sub: user.id, sid: session.id, org: organizationId };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: config.accessTokenTtlSeconds });
    return { accessToken, expiresIn: config.accessTokenTtlSeconds, refreshToken, refreshExpiresAt } satisfies IssuedTokens;
  }

  /**
   * Rotação de refresh token. Se um token já rotacionado for reapresentado fora da janela de tolerância,
   * assume-se roubo: toda a família de sessões é revogada.
   */
  async refresh(refreshToken: string | undefined, meta: ClientMeta) {
    if (!refreshToken) throw new UnauthorizedException('Sessão não encontrada');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.crypto.sha256(refreshToken) },
      include: { user: { include: { organization: { select: { isActive: true } } } } },
    });
    if (!session || session.revokedAt) throw new UnauthorizedException('Sessão encerrada');

    if (session.rotatedAt) {
      if (Date.now() - session.rotatedAt.getTime() < ROTATION_GRACE_MS) {
        // Outra aba acabou de renovar; o navegador já recebeu o cookie novo. O cliente tenta de novo.
        throw new UnauthorizedException({ message: 'Sessão renovada em outra aba', code: 'ROTATED' });
      }
      await this.revokeFamily(session.familyId, 'reuse_detected');
      await this.audit.log({
        organizationId: session.user.organizationId,
        actorUserId: session.userId,
        actorName: session.user.name,
        action: AuditAction.TOKEN_REUSE,
        entity: 'session',
        entityId: session.familyId,
        summary: 'Reuso de token de sessão detectado — todas as sessões desta cadeia foram encerradas',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Sessão encerrada por segurança. Entre novamente.');
    }

    if (session.expiresAt < new Date() || !session.user.isActive || !session.user.organization.isActive) {
      throw new UnauthorizedException('Sessão expirada');
    }

    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date(), lastUsedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException({ message: 'Sessão renovada em outra aba', code: 'ROTATED' });
    }
    return this.issueSession(session.user, meta, session.user.organizationId, session.familyId);
  }

  private revokeFamily(familyId: string, reason: string) {
    return this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async logout(ctx: RequestContext | null, refreshToken: string | undefined, meta: ClientMeta) {
    let familyId: string | undefined;
    let userId: string | undefined;
    let organizationId: string | undefined;
    if (ctx) {
      const s = await this.prisma.session.findUnique({ where: { id: ctx.user.sessionId } });
      familyId = s?.familyId;
      userId = ctx.user.id;
      organizationId = ctx.user.organizationId;
    } else if (refreshToken) {
      const s = await this.prisma.session.findUnique({
        where: { tokenHash: this.crypto.sha256(refreshToken) },
        include: { user: { select: { organizationId: true } } },
      });
      familyId = s?.familyId;
      userId = s?.userId;
      organizationId = s?.user.organizationId;
    }
    if (!familyId || !organizationId) return;
    await this.revokeFamily(familyId, 'logout');
    await this.audit.log({
      organizationId,
      actorUserId: userId,
      actorName: ctx?.user.name,
      action: AuditAction.LOGOUT,
      entity: 'session',
      entityId: familyId,
      summary: 'Logout',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** Sessões ativas do usuário: uma por família (a mais recente de cada cadeia). */
  async listSessions(ctx: RequestContext) {
    const current = await this.prisma.session.findUnique({ where: { id: ctx.user.sessionId } });
    const rows = await this.prisma.session.findMany({
      where: { userId: ctx.user.id, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.familyId,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      lastUsedAt: s.lastUsedAt,
      createdAt: s.createdAt,
      isCurrent: s.familyId === current?.familyId,
    }));
  }

  async revokeSession(ctx: RequestContext, familyId: string) {
    const owned = await this.prisma.session.findFirst({ where: { familyId, userId: ctx.user.id } });
    if (!owned) throw new BadRequestException('Sessão não encontrada');
    await this.revokeFamily(familyId, 'revoked_by_user');
    await this.audit.record(ctx, {
      action: AuditAction.LOGOUT,
      entity: 'session',
      entityId: familyId,
      summary: 'Sessão encerrada pelo usuário',
    });
  }

  async revokeOtherSessions(ctx: RequestContext) {
    const current = await this.prisma.session.findUnique({ where: { id: ctx.user.sessionId } });
    const result = await this.prisma.session.updateMany({
      where: { userId: ctx.user.id, revokedAt: null, NOT: { familyId: current?.familyId } },
      data: { revokedAt: new Date(), revokeReason: 'revoked_others' },
    });
    await this.audit.record(ctx, {
      action: AuditAction.LOGOUT,
      entity: 'session',
      summary: 'Encerrou as demais sessões',
    });
    return { revoked: result.count };
  }

  // ───────────────────────── senha ─────────────────────────

  /** Resposta sempre igual, exista ou não o e-mail (evita descobrir contas cadastradas). */
  async forgotPassword(email: string, meta: ClientMeta) {
    const users = await this.prisma.user.findMany({
      where: { email, isActive: true, organization: { isActive: true } },
      include: { organization: { select: { name: true } } },
    });
    for (const user of users) {
      await this.sendPasswordLink(user, 'reset', meta);
    }
  }

  /** Gera token de uso único e envia link. kind=invite vale 72 h (convite de novo usuário). */
  async sendPasswordLink(
    user: Pick<User, 'id' | 'name' | 'email' | 'organizationId'> & { organization?: { name: string } },
    kind: 'reset' | 'invite',
    meta: ClientMeta,
    actor?: RequestContext,
  ) {
    const token = this.crypto.randomToken();
    const ttlMinutes = kind === 'invite' ? 72 * 60 : config.passwordResetTtlMinutes;
    await this.prisma.$transaction([
      // Um novo link invalida os anteriores ainda não usados.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.crypto.sha256(token),
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        },
      }),
    ]);
    const orgName =
      user.organization?.name ??
      (await this.prisma.organization.findUnique({ where: { id: user.organizationId } }))?.name ??
      '';
    const link = `${config.webUrl}/redefinir-senha?token=${encodeURIComponent(token)}${kind === 'invite' ? '&convite=1' : ''}`;
    const firstName = user.name.split(' ')[0];
    await this.email.send(
      kind === 'invite'
        ? {
            to: user.email,
            subject: `Convite para acessar o sistema da ${orgName}`,
            text: `Olá, ${firstName}!\n\nVocê foi convidado(a) para acessar o sistema da ${orgName}.\nDefina sua senha pelo link abaixo (válido por 72 horas):\n\n${link}\n`,
          }
        : {
            to: user.email,
            subject: 'Redefinição de senha',
            text: `Olá, ${firstName}!\n\nRecebemos um pedido para redefinir sua senha em ${orgName}.\nUse o link abaixo (válido por ${config.passwordResetTtlMinutes} minutos):\n\n${link}\n\nSe não foi você, ignore este e-mail — sua senha continua a mesma.`,
          },
    );
    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: actor?.user.id ?? user.id,
      actorName: actor?.user.name ?? user.name,
      action: AuditAction.PASSWORD_RESET_REQUEST,
      entity: 'user',
      entityId: user.id,
      summary: kind === 'invite' ? 'Convite de acesso enviado' : 'Link de redefinição de senha enviado',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async resetPassword(dto: ResetPasswordDto, meta: ClientMeta) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.crypto.sha256(dto.token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
      throw new BadRequestException('Link inválido ou expirado. Solicite um novo.');
    }
    const passwordHash = await this.crypto.hashPassword(dto.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'password_reset' },
      });
      await this.audit.log(
        {
          organizationId: record.user.organizationId,
          actorUserId: record.userId,
          actorName: record.user.name,
          action: AuditAction.PASSWORD_RESET,
          entity: 'user',
          entityId: record.userId,
          summary: 'Senha redefinida por link; todas as sessões foram encerradas',
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
    });
  }

  async changePassword(ctx: RequestContext, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!(await this.crypto.verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Senha atual incorreta');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }
    const current = await this.prisma.session.findUnique({ where: { id: ctx.user.sessionId } });
    const passwordHash = await this.crypto.hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { familyId: current?.familyId } },
        data: { revokedAt: new Date(), revokeReason: 'password_change' },
      });
      await this.audit.record(
        ctx,
        { action: AuditAction.PASSWORD_CHANGE, entity: 'user', entityId: user.id, summary: 'Senha alterada; outras sessões encerradas' },
        tx,
      );
    });
  }

  // ───────────────────────── perfil ─────────────────────────

  async me(ctx: RequestContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      include: {
        organization: { include: { settings: true } },
        role: { include: { permissions: true } },
        permissionOverrides: true,
        professional: true,
        userUnits: { include: { unit: { select: { id: true, name: true } } } },
      },
    });
    const s = user.organization.settings;
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        role: { id: user.roleId, key: user.role.key, name: user.role.name },
        isProfessional: !!user.professional,
        units: user.userUnits.map((u) => u.unit),
        lastLoginAt: user.lastLoginAt,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        clinicName: s?.clinicName ?? user.organization.name,
        logoUrl: s?.logoUrl ?? null,
        timezone: user.organization.timezone,
        onboardingCompleted: !!s?.onboardingCompletedAt,
        onboardingStep: s?.onboardingStep ?? 0,
      },
      permissions: effectivePermissions(user.role.permissions.map((p) => p.permissionCode), user.permissionOverrides),
    };
  }

  async updateProfile(ctx: RequestContext, dto: UpdateProfileDto) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    const after = await this.prisma.user.update({ where: { id: ctx.user.id }, data: dto });
    await this.audit.record(ctx, {
      action: AuditAction.UPDATE,
      entity: 'user',
      entityId: after.id,
      summary: 'Perfil atualizado',
      changes: AuditService.diff(before, after),
    });
    return this.me(ctx);
  }


}
