import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { config } from '../../common/config';
import { Ctx, Public } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { AuthService, ClientMeta, IssuedTokens } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, UpdateProfileDto } from './auth.dto';

const COOKIE_PATH = '/api/v1/auth';

function meta(req: Request): ClientMeta {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/** O refresh token só trafega em cookie httpOnly — nunca fica acessível ao JavaScript do navegador. */
function setRefreshCookie(res: Response, tokens: IssuedTokens) {
  res.cookie(config.refreshCookieName, tokens.refreshToken, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: COOKIE_PATH,
    expires: tokens.refreshExpiresAt,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(config.refreshCookieName, { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: COOKIE_PATH });
}

function publicTokens(t: IssuedTokens) {
  return { accessToken: t.accessToken, expiresIn: t.expiresIn };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.register(dto, meta(req));
    setRefreshCookie(res, tokens);
    return publicTokens(tokens);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, meta(req));
    if ('requiresOrganization' in result) return result;
    setRefreshCookie(res, result);
    return publicTokens(result);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.refresh(req.cookies?.[config.refreshCookieName], meta(req));
    setRefreshCookie(res, tokens);
    return publicTokens(tokens);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(null, req.cookies?.[config.refreshCookieName], meta(req));
    clearRefreshCookie(res);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, meta(req));
    return { message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.resetPassword(dto, meta(req));
    clearRefreshCookie(res);
    return { message: 'Senha redefinida. Entre com a nova senha.' };
  }

  // ───── área autenticada: meu perfil e minhas sessões ─────

  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx);
  }

  @Patch('me')
  updateMe(@Ctx() ctx: RequestContext, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(ctx, dto);
  }

  @HttpCode(204)
  @Post('change-password')
  changePassword(@Ctx() ctx: RequestContext, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(ctx, dto);
  }

  @Get('sessions')
  sessions(@Ctx() ctx: RequestContext) {
    return this.auth.listSessions(ctx);
  }

  @HttpCode(204)
  @Delete('sessions/:familyId')
  revoke(@Ctx() ctx: RequestContext, @Param('familyId', ParseUUIDPipe) familyId: string) {
    return this.auth.revokeSession(ctx, familyId);
  }

  @Post('sessions/revoke-others')
  revokeOthers(@Ctx() ctx: RequestContext) {
    return this.auth.revokeOtherSessions(ctx);
  }
}
