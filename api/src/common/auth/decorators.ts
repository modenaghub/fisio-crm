import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../permissions';
import type { AuthRequest, RequestContext } from './auth.types';

export const IS_PUBLIC = 'isPublic';
/** Rota sem autenticação (login, cadastro, recuperação de senha, webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
/** Exige TODAS as permissões informadas. */
export const RequirePermissions = (...perms: PermissionCode[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthRequest>().user;
});

/** Usuário + IP + user-agent — o que os serviços precisam para auditar. */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<AuthRequest>();
  return { user: req.user!, ip: req.ip, userAgent: req.headers['user-agent'] };
});
