/**
 * Contrato da integração WhatsApp — Fase 7.
 * Implementação real prevista: WhatsApp Business Platform (Cloud API oficial da Meta).
 *  - Mensagens iniciadas pela clínica fora da janela de 24 h exigem template aprovado.
 *  - O webhook de entrada deve validar a assinatura X-Hub-Signature-256.
 * Nada aqui usa automação de WhatsApp Web ou métodos não oficiais.
 */
export interface WhatsAppTextMessage {
  to: string; // E.164
  body: string;
  buttons?: string[]; // botões de resposta rápida (máx. 3)
}

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  language: string; // pt_BR
  variables: string[];
}

export interface InboundWhatsAppMessage {
  from: string;
  externalId: string;
  text?: string;
  buttonPayload?: string;
  receivedAt: Date;
}

export interface WhatsAppProvider {
  readonly mode: 'mock' | 'real';
  sendText(msg: WhatsAppTextMessage): Promise<{ externalId: string }>;
  sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ externalId: string }>;
  /** Valida e converte o payload do webhook. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): InboundWhatsAppMessage[];
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
