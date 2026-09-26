import { Controller, Get, Module, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/prisma.service';
import { Public } from '../../common/auth/decorators';
import { config } from '../../common/config';
import { MockEmailProvider } from '../../integrations/email/mock-email.provider';

@Controller()
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
  }

  /** Informa ao frontend quais integrações estão em modo demonstração. */
  @Public()
  @Get('system/info')
  info() {
    return {
      environment: config.isProd ? 'production' : 'development',
      integrations: { email: config.emailProvider, whatsapp: config.whatsappProvider },
      devMailbox: !config.isProd && config.emailProvider === 'mock',
    };
  }

  /**
   * SOMENTE DESENVOLVIMENTO: caixa de saída do e-mail de demonstração (links de convite e redefinição).
   * Desativada em produção ou quando um provedor real de e-mail está configurado.
   */
  @Public()
  @Get('dev/mailbox')
  mailbox() {
    if (config.isProd || config.emailProvider !== 'mock') throw new NotFoundException();
    return MockEmailProvider.outbox;
  }
}

@Module({ controllers: [SystemController] })
export class SystemModule {}
