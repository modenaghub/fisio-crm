import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  InboundWhatsAppMessage,
  WhatsAppProvider,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from './whatsapp.provider';

/**
 * MODO DEMONSTRAÇÃO — nenhuma mensagem é enviada ao WhatsApp.
 * INTEGRAÇÃO REAL: criar CloudWhatsAppProvider chamando
 * POST https://graph.facebook.com/{versão}/{PHONE_NUMBER_ID}/messages com WHATSAPP_TOKEN,
 * e validar o webhook com WHATSAPP_APP_SECRET. Ativar com WHATSAPP_PROVIDER=cloud.
 */
@Injectable()
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly mode = 'mock' as const;
  private readonly logger = new Logger('WhatsAppMock');

  async sendText(msg: WhatsAppTextMessage) {
    this.logger.log(`[DEMO] WhatsApp para ${msg.to}: ${msg.body.slice(0, 80)}`);
    return { externalId: `mock-${randomUUID()}` };
  }

  async sendTemplate(msg: WhatsAppTemplateMessage) {
    this.logger.log(`[DEMO] template ${msg.templateName} para ${msg.to}`);
    return { externalId: `mock-${randomUUID()}` };
  }

  parseWebhook(rawBody: Buffer): InboundWhatsAppMessage[] {
    // No modo demonstração o simulador interno envia { from, text }.
    const body = JSON.parse(rawBody.toString('utf8'));
    return [{ from: body.from, text: body.text, externalId: `mock-${randomUUID()}`, receivedAt: new Date() }];
  }
}
