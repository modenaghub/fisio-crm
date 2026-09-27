import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundWhatsAppMessage, WhatsAppProvider, WhatsAppTemplateMessage, WhatsAppTextMessage } from './whatsapp.provider';

/**
 * INTEGRAÇÃO REAL — WhatsApp Business Platform (Cloud API oficial da Meta).
 * Variáveis: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN,
 * WHATSAPP_API_VERSION (padrão v21.0). Cada clínica associa o seu phone_number_id em Integrações.
 */
@Injectable()
export class CloudWhatsAppProvider implements WhatsAppProvider {
  readonly mode = 'real' as const;
  private readonly logger = new Logger('WhatsAppCloud');
  private readonly version = process.env.WHATSAPP_API_VERSION ?? 'v21.0';

  private async post(payload: Record<string, unknown>) {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_TOKEN;
    if (!phoneId || !token) throw new Error('WhatsApp Cloud API não configurada (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN)');
    const r = await fetch(`https://graph.facebook.com/${this.version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const body = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
    if (!r.ok || !body.messages?.[0]?.id) throw new Error(body.error?.message ?? `WhatsApp respondeu ${r.status}`);
    return { externalId: body.messages[0].id };
  }

  sendText(msg: WhatsAppTextMessage) {
    if (msg.buttons?.length) {
      return this.post({
        to: msg.to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: msg.body.slice(0, 1024) },
          action: { buttons: msg.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b, title: b.slice(0, 20) } })) },
        },
      });
    }
    return this.post({ to: msg.to, type: 'text', text: { body: msg.body.slice(0, 4096), preview_url: false } });
  }

  sendTemplate(msg: WhatsAppTemplateMessage) {
    return this.post({
      to: msg.to,
      type: 'template',
      template: {
        name: msg.templateName,
        language: { code: msg.language },
        components: msg.variables.length ? [{ type: 'body', parameters: msg.variables.map((text) => ({ type: 'text', text })) }] : [],
      },
    });
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): InboundWhatsAppMessage[] {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) throw new UnauthorizedException('WHATSAPP_APP_SECRET ausente');
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new UnauthorizedException('Assinatura do webhook inválida');
    }
    const body = JSON.parse(rawBody.toString('utf8'));
    const out: InboundWhatsAppMessage[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        const phoneNumberId = v.metadata?.phone_number_id;
        const names = Object.fromEntries((v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
        for (const m of v.messages ?? []) {
          out.push({
            kind: 'message',
            phoneNumberId,
            from: m.from,
            externalId: m.id,
            profileName: names[m.from],
            text: m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title,
            buttonPayload: m.button?.payload ?? m.interactive?.button_reply?.id,
            receivedAt: new Date(Number(m.timestamp) * 1000),
          });
        }
        for (const s of v.statuses ?? []) {
          out.push({ kind: 'status', phoneNumberId, from: s.recipient_id, externalId: s.id, status: s.status, errorMessage: s.errors?.[0]?.title, receivedAt: new Date(Number(s.timestamp) * 1000) });
        }
      }
    }
    this.logger.debug(`webhook: ${out.length} evento(s)`);
    return out;
  }

  verifyToken(token: string | undefined) {
    return !!token && token === process.env.WHATSAPP_VERIFY_TOKEN;
  }
}
