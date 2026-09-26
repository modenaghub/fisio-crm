import type { Request } from 'express';

/** Contexto do usuário autenticado, anexado a cada requisição pelo JwtAuthGuard. */
export interface AuthUser {
  id: string;
  sessionId: string;
  organizationId: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  org: string;
  iat?: number;
  exp?: number;
}

export type AuthRequest = Request & { user?: AuthUser };

/** Contexto usado por serviços e pela auditoria. */
export interface RequestContext {
  user: AuthUser;
  ip?: string;
  userAgent?: string;
}
