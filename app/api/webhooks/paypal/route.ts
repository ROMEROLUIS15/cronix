import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWebhookSignature } from '@/lib/payments/paypal';
import { finalizePayPalPayment } from '@/lib/payments/subscription-fulfillment';
import { logger } from '@/lib/logger';

/**
 * Webhook async de PayPal — red de seguridad cuando el flujo del frontend
 * (capturePayPalOrderAction) no completa por cierre de pestaña, red caída,
 * o error del navegador.
 *
 * Eventos manejados:
 *  - PAYMENT.CAPTURE.COMPLETED: monto y orderId disponibles directamente.
 *  - CHECKOUT.ORDER.APPROVED: solo trae intento de pago, no capturamos aquí
 *    (PayPal exige `capture` explícito; lo hace el frontend o el cron de retry).
 *
 * Toda la fulfillment se delega a `finalizePayPalPayment`, que es idempotente,
 * así que es seguro recibir el mismo evento múltiples veces.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  // 1. Verificar firma — si falla, no tocamos nada
  const isValid = await verifyWebhookSignature(req.headers, rawBody);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: { event_type?: string; resource?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = event.event_type;
  const resource = event.resource ?? {};

  // Solo procesamos capturas completadas
  if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
    return NextResponse.json({ received: true, ignored: eventType });
  }

  // Extraer orderId del supplementary_data (PayPal lo provee aquí en eventos de captura)
  const supplementary = resource.supplementary_data as
    | { related_ids?: { order_id?: string } }
    | undefined;
  const orderId = supplementary?.related_ids?.order_id;

  const amountObj = resource.amount as { value?: string } | undefined;
  const capturedAmount = amountObj?.value ? Number(amountObj.value) : null;

  if (!orderId) {
    logger.warn('PAYPAL-WEBHOOK', 'PAYMENT.CAPTURE.COMPLETED without related order_id', { event });
    return NextResponse.json({ received: true, missing: 'order_id' });
  }

  const supabaseAdmin = createAdminClient();
  const result = await finalizePayPalPayment(supabaseAdmin, orderId, capturedAmount);

  switch (result.status) {
    case 'completed':
    case 'already_processed':
      return NextResponse.json({ success: true, result: result.status });
    case 'invoice_not_found':
      logger.warn('PAYPAL-WEBHOOK', 'Order not found in saas_invoices', { orderId });
      return NextResponse.json({ received: true, missing: 'invoice' });
    case 'amount_mismatch':
      logger.error('PAYPAL-WEBHOOK', 'Amount mismatch', { orderId, ...result });
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
    case 'db_error':
      logger.error('PAYPAL-WEBHOOK', 'DB error', { orderId, message: result.message });
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
