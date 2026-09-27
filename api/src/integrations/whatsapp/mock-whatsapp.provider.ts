import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { InboundWhatsAppMessage, WhatsAppProvider, WhatsAppTemplateMessage, WhatsAppTextMessage } from './whatsapp.provider';

/**
 * MODO DEMONSTRAÇÃO — nenhuma mensagem sai para o WhatsApp; tudo fica registrado no sistema.
 * O simulador da tela Comunicação envia { from, text } para o webhook, como se o paciente tivesse escrito.
 * Para produção: WHATSAPP_PROVIDER=cloud (ver CloudWhatsAppProvider).
 */
@Injectable()
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly mode = 'mock' as const;
  private readonly logger = new Logger('WhatsAppMock');

  async sendText(msg: WhatsAppTextMessage) {
    this.logger.log(`[DEMO] WhatsApp para ${msg.to}: ${msg.body.slice(0, 80)}${msg.buttons?.length ? ` [${msg.buttons.join(' | ')}]` : ''}`);
    return { externalId: `mock-${randomUUID()}` };
  }

  async sendTemplate(msg: WhatsAppTemplateMessage) {
    this.logger.log(`[DEMO] template ${msg.templateName} para ${msg.to}`);
    return { externalId: `mock-${randomUUID()}` };
  }

  parseWebhook(rawBody: Buffer): InboundWhatsAppMessage[] {
    const body = JSON.parse(rawBody.toString('utf8') || '{}');
    if (!body.from || (!body.text && !body.buttonPayload)) return [];
    return [{ kind: 'message', from: String(body.from), text: body.text, buttonPayload: body.buttonPayload, profileName: body.name, externalId: body.id ?? `mock-${randomUUID()}`, receivedAt: new Date() }];
  }

  verifyToken() {
    return true;
  }
}
