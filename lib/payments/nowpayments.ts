import crypto from 'crypto';

// Usamos variable de entorno para permitir cambiar a Sandbox si es necesario
const API_URL = process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1';
export type NOWPaymentsInvoiceRequest = {
  price_amount: number;
  price_currency: string;
  pay_currency?: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
  order_id: string;
  order_description?: string;
  ipn_callback_url?: string;
  success_url?: string;
  cancel_url?: string;
};

export type NOWPaymentsInvoiceResponse = {
  id: string;
  order_id: string;
  order_description: string;
  price_amount: string;
  price_currency: string;
  pay_currency: string | null;
  ipn_callback_url: string;
  invoice_url: string;
  success_url: string;
  cancel_url: string;
  created_at: string;
  updated_at: string;
};

export class NOWPaymentsAPI {
  private apiKey: string;
  private ipnSecret: string;

  constructor() {
    this.apiKey = process.env.NOWPAYMENTS_API_KEY || '';
    this.ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET || '';

    if (!this.apiKey || !this.ipnSecret) {
      console.warn('NOWPayments credentials are not fully configured in environment variables.');
    }
  }

  /**
   * Generates a new payment invoice link.
   */
  async createInvoice(params: NOWPaymentsInvoiceRequest): Promise<{ invoice_url?: string; invoice_id?: string; error?: string }> {
    try {
      const response = await fetch(`${API_URL}/invoice`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[NOWPayments] Invoice creation failed:', JSON.stringify(data));
        return { error: data.message || 'Failed to create invoice' };
      }

      const resData = data as NOWPaymentsInvoiceResponse;
      return {
        invoice_url: resData.invoice_url,
        invoice_id: resData.id?.toString()
      };
    } catch (error: any) {
      console.error('NOWPayments Fetch Error:', error);
      return { error: 'Internal error communicating with payment gateway' };
    }
  }

  /**
   * Verifies the HMAC signature from NOWPayments Webhooks (IPN)
   */
  verifyIpnSignature(payload: string | object, signature: string): boolean {
    if (!signature || !this.ipnSecret) return false;

    // The payload must be sorted if it's an object, but NOWPayments signs the raw JSON string.
    // However, stringifying object properties in a different order might break the signature.
    // According to docs, they stringify the JSON payload with keys sorted alphabetically.
    
    let stringPayload = '';
    if (typeof payload === 'string') {
      stringPayload = payload;
    } else {
      // Sort keys alphabetically as per NOWPayments docs
      const sortedKeys = Object.keys(payload).sort();
      const sortedPayload: Record<string, any> = {};
      for (const key of sortedKeys) {
        sortedPayload[key] = (payload as any)[key];
      }
      stringPayload = JSON.stringify(sortedPayload);
    }

    const hmac = crypto.createHmac('sha512', this.ipnSecret);
    hmac.update(stringPayload);
    const calculatedSignature = hmac.digest('hex');

    return calculatedSignature === signature;
  }
}

export const nowpayments = new NOWPaymentsAPI();
