import { Global, Module } from '@nestjs/common';
import { config } from '../common/config';
import { EMAIL_PROVIDER } from './email/email.provider';
import { MockEmailProvider } from './email/mock-email.provider';
import { SmtpEmailProvider } from './email/smtp-email.provider';
import { WHATSAPP_PROVIDER } from './whatsapp/whatsapp.provider';
import { MockWhatsAppProvider } from './whatsapp/mock-whatsapp.provider';
import { CALENDAR_PROVIDER, MockCalendarProvider } from './calendar/calendar.provider';
import { MockPaymentGateway, PAYMENT_GATEWAY } from './payments/payment-gateway';
import { AI_PROVIDER, MockAiProvider } from './ai/ai.provider';

/**
 * Cada integração é injetada por token. Trocar mock → real é só mudar a variável de ambiente
 * e implementar a classe marcada com "INTEGRAÇÃO REAL".
 */
@Global()
@Module({
  providers: [
    { provide: EMAIL_PROVIDER, useClass: config.emailProvider === 'smtp' ? SmtpEmailProvider : MockEmailProvider },
    // INTEGRAÇÃO REAL: WHATSAPP_PROVIDER=cloud → CloudWhatsAppProvider (Fase 7)
    { provide: WHATSAPP_PROVIDER, useClass: MockWhatsAppProvider },
    { provide: CALENDAR_PROVIDER, useClass: MockCalendarProvider },
    { provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway },
    { provide: AI_PROVIDER, useClass: MockAiProvider },
  ],
  exports: [EMAIL_PROVIDER, WHATSAPP_PROVIDER, CALENDAR_PROVIDER, PAYMENT_GATEWAY, AI_PROVIDER],
})
export class IntegrationsModule {}
