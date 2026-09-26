/**
 * Contrato do gateway de pagamento — Fase 6.
 * INTEGRAÇÃO REAL: gateway com PIX e cartão (ex.: Asaas, Mercado Pago, Stripe).
 * O webhook de confirmação deve atualizar Payment.status e gerar FinancialTransaction.
 */
export interface ChargeRequest {
  paymentId: string;
  amountCents: number;
  description: string;
  customer: { name: string; email?: string; phone?: string; cpf?: string };
  method: 'PIX' | 'CREDIT_CARD' | 'BOLETO';
  dueDate: Date;
}

export interface ChargeResult {
  chargeId: string;
  pixCopyPaste?: string;
  checkoutUrl?: string;
}

export interface PaymentGateway {
  readonly mode: 'mock' | 'real';
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  cancelCharge(chargeId: string): Promise<void>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export class MockPaymentGateway implements PaymentGateway {
  readonly mode = 'mock' as const;
  async createCharge(req: ChargeRequest) {
    return { chargeId: `mock-charge-${req.paymentId}`, pixCopyPaste: 'DEMONSTRACAO-SEM-VALOR' };
  }
  async cancelCharge() {}
}
