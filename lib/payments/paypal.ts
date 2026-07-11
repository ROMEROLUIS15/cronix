// lib/payments/paypal.ts

import { logger } from '@/lib/logger';

const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

// Sandbox por defecto: cobrar dinero real es opt-in explícito.
// Vercel pone NODE_ENV=production en todos los deploys (incluyendo previews),
// así que NO usamos NODE_ENV como señal. Solo PAYPAL_ENV=live activa Live.
const isLive = process.env.PAYPAL_ENV === 'live';
const PAYPAL_API_BASE = isLive
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function generateAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('Faltan las credenciales de PayPal en las variables de entorno.');
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`PayPal Access Token error: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

export async function createOrder(amountUsd: number, description: string) {
  const accessToken = await generateAccessToken();
  const url = `${PAYPAL_API_BASE}/v2/checkout/orders`;

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        description: description,
        amount: {
          currency_code: 'USD',
          value: amountUsd.toFixed(2),
        },
      },
    ],
    application_context: {
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    logger.error('PAYPAL-API', 'Create order error', data);
    return { error: 'Failed to create PayPal order' };
  }

  return { id: data.id };
}

export async function captureOrder(orderId: string) {
  const accessToken = await generateAccessToken();
  const url = `${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    logger.error('PAYPAL-API', 'Capture order error', data);
    return { error: 'Failed to capture PayPal order' };
  }

  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  const amount = capture?.amount?.value ? Number(capture.amount.value) : null;
  const currency = capture?.amount?.currency_code ?? null;

  return {
    id: data.id as string,
    status: data.status as string, // Should be 'COMPLETED'
    amount,
    currency,
  };
}

/**
 * Verifica la firma de un webhook de PayPal usando la API oficial
 * `/v1/notifications/verify-webhook-signature`. Devuelve true si PayPal confirma
 * que la transmisión es auténtica.
 *
 * Requiere PAYPAL_WEBHOOK_ID (lo obtienes al registrar el webhook en el dashboard).
 */
export async function verifyWebhookSignature(
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    logger.error('PAYPAL-WEBHOOK', 'PAYPAL_WEBHOOK_ID not configured');
    return false;
  }

  const authAlgo = headers.get('paypal-auth-algo');
  const certUrl = headers.get('paypal-cert-url');
  const transmissionId = headers.get('paypal-transmission-id');
  const transmissionSig = headers.get('paypal-transmission-sig');
  const transmissionTime = headers.get('paypal-transmission-time');

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    logger.warn('PAYPAL-WEBHOOK', 'Missing required PayPal headers');
    return false;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    logger.warn('PAYPAL-WEBHOOK', 'Body is not valid JSON');
    return false;
  }

  const accessToken = await generateAccessToken();
  const verifyRes = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: parsedBody,
    }),
  });

  if (!verifyRes.ok) {
    const errorBody = await verifyRes.text().catch(() => '<unreadable>');
    logger.error('PAYPAL-WEBHOOK', 'Verification API error', {
      status: verifyRes.status,
      body: errorBody,
      sentWebhookIdLength: webhookId.length,
      sentWebhookIdFirstChars: webhookId.substring(0, 8),
      apiBase: PAYPAL_API_BASE,
    });
    return false;
  }

  const verifyData = await verifyRes.json();
  if (verifyData.verification_status !== 'SUCCESS') {
    logger.warn('PAYPAL-WEBHOOK', 'Verification status not SUCCESS', verifyData);
  }
  return verifyData.verification_status === 'SUCCESS';
}
