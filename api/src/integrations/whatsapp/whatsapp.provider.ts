/**
 * Contrato da integração WhatsApp.
 * Implementação real: WhatsApp Business Platform (Cloud API oficial da Meta) — CloudWhatsAppProvider.
 *  - Mensagens iniciadas pela clínica fora da janela de 24 h exigem template aprovado.
 *  - O webhook de entrada valida a assinatura X-Hub-Signature-256.
 * Nada aqui usa automação de WhatsApp Web ou métodos não oficiais.
 */
export interface WhatsAppTextMessage {
  to: string; // wa_id (DDI + número, só dígitos)
  body: string;
  buttons?: string[]; // botões de resposta rápida (máx. 3)
}

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  language: string; // pt_BR
  variables: string[];
}

/** Evento recebido pelo webhook: mensagem do contato ou atualização de status de uma mensagem enviada. */
export interface InboundWhatsAppMessage {
  kind: 'message' | 'status';
  /** Número da clínica que recebeu (Cloud API: phone_number_id) — identifica a organização. */
  phoneNumberId?: string;
  from: string;
  externalId: string;
  profileName?: string;
  text?: string;
  buttonPayload?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  errorMessage?: string;
  receivedAt: Date;
}

export interface WhatsAppProvider {
  readonly mode: 'mock' | 'real';
  sendText(msg: WhatsAppTextMessage): Promise<{ externalId: string }>;
  sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ externalId: string }>;
  /** Valida a assinatura e converte o payload do webhook. Lança erro se a assinatura não confere. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): InboundWhatsAppMessage[];
  /** Handshake GET do webhook (hub.verify_token). */
  verifyToken(token: string | undefined): boolean;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
