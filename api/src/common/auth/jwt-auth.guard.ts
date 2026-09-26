import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { effectivePermissions } from '../permissions';
import { IS_PUBLIC } from './decorators';
import type { AccessTokenPayload, AuthRequest } from './auth.types';

/**
 * Guard global. Além de validar o JWT, confirma no banco que:
 *  - a sessão não foi revogada (logout, troca de senha, reuso de token);
 *  - o usuário e a organização continuam ativos.
 * Assim, desativar um usuário corta o acesso imediatamente, sem esperar o token expirar.
 * As permissões são recalculadas a cada requisição — mudanças valem na hora.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sessão não encontrada');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Sessão expirada');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          include: {
            organization: { select: { isActive: true } },
            role: { include: { permissions: { select: { permissionCode: true } } } },
            permissionOverrides: { select: { permissionCode: true, granted: true } },
          },
        },
      },
    });

    const user = session?.user;
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      !user ||
      user.id !== payload.sub ||
      user.organizationId !== payload.org ||
      !user.isActive ||
      !user.organization.isActive
    ) {
      throw new UnauthorizedException('Sessão encerrada');
    }

    req.user = {
      id: user.id,
      sessionId: session.id,
      organizationId: user.organizationId,
      name: user.name,
      email: user.email,
      roleKey: user.role.key,
      roleName: user.role.name,
      permissions: effectivePermissions(
        user.role.permissions.map((p) => p.permissionCode),
        user.permissionOverrides,
      ),
    };
    return true;
  }
}
