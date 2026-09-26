import { Injectable, NotImplementedException } from '@nestjs/common';
import type { EmailMessage, EmailProvider } from './email.provider';

/**
 * INTEGRAÇÃO REAL: conectar aqui o provedor de e-mail transacional
 * (SMTP via nodemailer, Amazon SES, Resend…). Variáveis sugeridas:
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM. Ativar com EMAIL_PROVIDER=smtp.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly mode = 'real' as const;
  async send(_message: EmailMessage): Promise<{ id: string }> {
    throw new NotImplementedException('Provedor SMTP ainda não configurado');
  }
}
