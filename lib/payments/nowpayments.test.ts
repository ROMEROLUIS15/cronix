import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { createHmac } from 'crypto';
import { nowpayments } from './nowpayments';

// Mock del fetch global
global.fetch = vi.fn();

interface NOWPaymentsTestAPI {
  apiKey: string;
  ipnSecret: string;
}

describe('NOWPaymentsAPI', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = {
      ...originalEnv,
      NOWPAYMENTS_API_KEY: 'test_api_key',
      NOWPAYMENTS_IPN_SECRET: 'test_ipn_secret',
    };

    const testInstance = nowpayments as unknown as NOWPaymentsTestAPI;
    testInstance.apiKey = 'test_api_key';
    testInstance.ipnSecret = 'test_ipn_secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('createInvoice', () => {
    it('debería retornar invoice_url e invoice_id cuando la API responde correctamente', async () => {
      const mockResponse = {
        id: '12345',
        invoice_url: 'https://nowpayments.io/payment/?iid=12345',
        order_id: 'bus-123',
        price_amount: '10.00',
        price_currency: 'usd',
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await nowpayments.createInvoice({
        price_amount: 10.00,
        price_currency: 'usd',
        order_id: 'bus-123',
      });

      expect(fetch).toHaveBeenCalledWith('https://api.nowpayments.io/v1/invoice', expect.objectContaining({
        method: 'POST',
        headers: {
          'x-api-key': 'test_api_key',
          'Content-Type': 'application/json',
        },
      }));

      expect(result.invoice_url).toBe('https://nowpayments.io/payment/?iid=12345');
      expect(result.invoice_id).toBe('12345');
      expect(result.error).toBeUndefined();
    });

    it('debería retornar un error si la API de NOWPayments falla', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Invalid API Key' }),
      } as Response);

      const result = await nowpayments.createInvoice({
        price_amount: 10.00,
        price_currency: 'usd',
        order_id: 'bus-123',
      });

      expect(result.error).toBe('Invalid API Key');
      expect(result.invoice_url).toBeUndefined();
    });

    it('debería manejar errores de red o excepciones', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await nowpayments.createInvoice({
        price_amount: 10.00,
        price_currency: 'usd',
        order_id: 'bus-123',
      });

      expect(result.error).toBe('Internal error communicating with payment gateway');
    });
  });

  describe('verifyIpnSignature', () => {
    it('debería retornar false si no se provee la firma', () => {
      const isValid = nowpayments.verifyIpnSignature({ payment_id: '123' }, '');
      expect(isValid).toBe(false);
    });

    it('debería validar correctamente una firma HMAC válida para un objeto JSON (keys ordenadas)', () => {
      const payload = {
        payment_status: 'finished',
        payment_id: '12345',
        price_amount: 10,
      };

      const sortedString = JSON.stringify({
        payment_id: '12345',
        payment_status: 'finished',
        price_amount: 10,
      });

      const hmac = createHmac('sha512', 'test_ipn_secret');
      hmac.update(sortedString);
      const validSignature = hmac.digest('hex');

      const isValid = nowpayments.verifyIpnSignature(payload, validSignature);

      expect(isValid).toBe(true);
    });

    it('debería validar correctamente una firma contra el raw body string', () => {
      const rawBody = JSON.stringify({
        payment_id: '12345',
        payment_status: 'finished',
        price_amount: 10,
      });

      const hmac = createHmac('sha512', 'test_ipn_secret');
      hmac.update(rawBody);
      const validSignature = hmac.digest('hex');

      const isValid = nowpayments.verifyIpnSignature(rawBody, validSignature);

      expect(isValid).toBe(true);
    });

    it('debería retornar false para una firma inválida', () => {
      const payload = {
        payment_status: 'finished',
        payment_id: '12345',
      };

      const invalidSignature = 'invalidhexstring1234567890';
      const isValid = nowpayments.verifyIpnSignature(payload, invalidSignature);

      expect(isValid).toBe(false);
    });
  });
});
