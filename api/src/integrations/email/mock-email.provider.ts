import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EmailMessage, EmailProvider } from './email.provider';

/**
 * MODO DEMONSTRAÇÃO — nenhum e-mail sai do servidor.
 * As mensagens ficam numa caixa em memória (as últimas 50), visível em /api/v1/dev/mailbox
 * fora de produção, para testar recuperação de senha sem configurar SMTP.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  readonly mode = 'mock' as const;
  private readonly logger = new Logger('EmailMock');
  static readonly outbox: (EmailMessage & { id: string; sentAt: string })[] = [];

  async send(message: EmailMessage) {
    const id = randomUUID();
    MockEmailProvider.outbox.unshift({ ...message, id, sentAt: new Date().toISOString() });
    MockEmailProvider.outbox.splice(50);
    this.logger.log(`[DEMO] e-mail para ${message.to}: ${message.subject}`);
    return { id };
  }
}
