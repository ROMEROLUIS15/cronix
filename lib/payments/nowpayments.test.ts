import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { nowpayments } from './nowpayments';

// Mock del fetch global
global.fetch = vi.fn();

describe('NOWPaymentsAPI', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { 
      ...originalEnv, 
      NOWPAYMENTS_API_KEY: 'test_api_key',
      NOWPAYMENTS_IPN_SECRET: 'test_ipn_secret' 
    };
    
    // Necesitamos recrear la instancia o mockear las propiedades privadas si fuera necesario.
    // Como el constructor lee process.env en tiempo de carga, ya debería estar cargado.
    // Para simplificar, asumimos que 'nowpayments' cargó bien el env si corremos en entorno test,
    // pero si no, inyectamos o testeamos el comportamiento.
    (nowpayments as any).apiKey = 'test_api_key';
    (nowpayments as any).ipnSecret = 'test_ipn_secret';
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
        price_currency: 'usd'
      };

      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const result = await nowpayments.createInvoice({
        price_amount: 10.00,
        price_currency: 'usd',
        order_id: 'bus-123'
      });

      expect(fetch).toHaveBeenCalledWith('https://api.nowpayments.io/v1/invoice', expect.objectContaining({
        method: 'POST',
        headers: {
          'x-api-key': 'test_api_key',
          'Content-Type': 'application/json'
        }
      }));

      expect(result.invoice_url).toBe('https://nowpayments.io/payment/?iid=12345');
      expect(result.invoice_id).toBe('12345');
      expect(result.error).toBeUndefined();
    });

    it('debería retornar un error si la API de NOWPayments falla', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Invalid API Key' })
      });

      const result = await nowpayments.createInvoice({
        price_amount: 10.00,
        price_currency: 'usd',
        order_id: 'bus-123'
      });

      expect(result.error).toBe('Invalid API Key');
      expect(result.invoice_url).toBeUndefined();
    });

    it('debería manejar errores de red o excepciones', async () => {
      (fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await nowpayments.createInvoice({
        price_amount: 10.00,
        price_currency: 'usd',
        order_id: 'bus-123'
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
      // payload original desordenado
      const payload = {
        payment_status: 'finished',
        payment_id: '12345',
        price_amount: 10
      };

      // NOWPayments ordena las llaves: payment_id, payment_status, price_amount
      const sortedString = JSON.stringify({
        payment_id: '12345',
        payment_status: 'finished',
        price_amount: 10
      });

      // Crear la firma válida manualmente usando el 'test_ipn_secret'
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha512', 'test_ipn_secret');
      hmac.update(sortedString);
      const validSignature = hmac.digest('hex');

      const isValid = nowpayments.verifyIpnSignature(payload, validSignature);
      
      expect(isValid).toBe(true);
    });

    it('debería retornar false para una firma inválida', () => {
      const payload = {
        payment_status: 'finished',
        payment_id: '12345'
      };

      const invalidSignature = 'invalidhexstring1234567890';
      const isValid = nowpayments.verifyIpnSignature(payload, invalidSignature);
      
      expect(isValid).toBe(false);
    });
  });
});
