'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { nowpayments } from '@/lib/payments/nowpayments';
import { fetchBcvRate, type BcvRateResult } from '@/lib/payments/bcv-rate';
import { createOrder as createPayPalOrder, captureOrder as capturePayPalOrder } from '@/lib/payments/paypal';
import { finalizePayPalPayment } from '@/lib/payments/subscription-fulfillment';

export type ManualPaymentMethod = 'pago_movil' | 'binance_manual';


export async function createSaaSCheckoutSession(plan: 'pro' | 'enterprise') {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Unauthorized' };
    }

    // Get user's business
    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .single();

    if (!business) {
      return { error: 'Business not found' };
    }

    const amountUsd = plan === 'pro' ? 10.00 : 15.00;

    // Call NOWPayments
    // order_id must be unique per invoice — append timestamp to avoid NOWPayments rejecting duplicates
    const orderId = `${business.id}-${Date.now()}`;

    const res = await nowpayments.createInvoice({
      price_amount: amountUsd,
      price_currency: 'usdtbsc', // Mirror currency: same as pay_currency → exact amount, no conversion
      pay_currency: 'usdtbsc',
      ipn_callback_url: `${process.env.APP_URL}/api/webhooks/nowpayments`,
      order_id: orderId,
      order_description: `cronix-${plan}`,
      success_url: `${process.env.APP_URL}/dashboard/settings?payment=success`,
      cancel_url: `${process.env.APP_URL}/dashboard/settings?payment=cancel`,
    });

    if (res.error || !res.invoice_url || !res.invoice_id) {
      return { error: res.error || 'Could not generate payment link' };
    }

    // Guardar el pre-registro de la factura usando el cliente admin (service role)
    // para evitar restricciones de RLS en saas_invoices que solo permiten INSERT al service role.
    const supabaseAdmin = createAdminClient();
    const { error: insertError } = await supabaseAdmin
      .from('saas_invoices')
      .insert({
        business_id: business.id,
        np_invoice_id: res.invoice_id,
        amount_usd: amountUsd,
        plan_purchased: plan,
        status: 'waiting'
      });

    if (insertError) {
      console.error('Error saving invoice:', insertError);
      return { error: 'Database error registering invoice' };
    }

    return { invoice_url: res.invoice_url };
  } catch (error) {
    console.error('Checkout Error:', error);
    return { error: 'Internal server error' };
  }
}

/**
 * Registers a manual payment (Pago Móvil / Binance) pending admin approval.
 * Returns { success: true } on success or { error: string } on failure.
 */
export async function submitManualPayment({
  plan,
  method,
  referenceNumber,
}: {
  plan: 'pro' | 'enterprise';
  method: ManualPaymentMethod;
  referenceNumber: string;
}): Promise<{ success?: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Unauthorized' };

    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .single();
    if (!business) return { error: 'Business not found' };

    const ref = referenceNumber.trim();
    if (!ref || ref.length < 4) return { error: 'Ingresa un número de referencia válido (mínimo 4 caracteres).' };

    const amountUsd = plan === 'pro' ? 10.00 : 15.00;

    const supabaseAdmin = createAdminClient();
    const { error: insertError } = await supabaseAdmin
      .from('saas_invoices')
      .insert({
        business_id: business.id,
        np_invoice_id: null,
        amount_usd: amountUsd,
        plan_purchased: plan,
        status: 'confirming',        // signals "awaiting manual review"
        payment_method: method,
        reference_number: ref,
      });

    if (insertError) {
      console.error('[ManualPayment] Insert error:', insertError);
      return { error: 'Error al registrar el pago. Inténtalo de nuevo.' };
    }

    return { success: true };
  } catch (err) {
    console.error('[ManualPayment] Unexpected error:', err);
    return { error: 'Error interno. Inténtalo de nuevo.' };
  }
}

/**
 * Server action to fetch the BCV exchange rate.
 * Must run server-side because ve.dolarapi.com blocks browser CORS requests.
 */
export async function getBcvRateAction(): Promise<BcvRateResult | null> {
  return fetchBcvRate();
}

/**
 * Crea una orden de PayPal y registra la factura en estado 'waiting'.
 */
export async function createPayPalOrderAction(plan: 'pro' | 'enterprise') {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { error: 'Unauthorized' };

    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .single();

    if (!business) return { error: 'Business not found' };

    const amountUsd = plan === 'pro' ? 10.00 : 15.00;
    const description = `Cronix ${plan === 'pro' ? 'Pro' : 'Enterprise'} Plan`;

    const res = await createPayPalOrder(amountUsd, description);
    if (res.error || !res.id) {
      return { error: res.error || 'No se pudo generar la orden de PayPal' };
    }

    const supabaseAdmin = createAdminClient();
    const { error: insertError } = await supabaseAdmin
      .from('saas_invoices')
      .insert({
        business_id: business.id,
        np_invoice_id: res.id, // Guardamos el order ID de PayPal aquí temporalmente
        amount_usd: amountUsd,
        plan_purchased: plan,
        status: 'waiting',
        payment_method: 'paypal'
      });

    if (insertError) {
      console.error('Error saving paypal invoice:', insertError);
      return { error: 'Error de base de datos registrando factura' };
    }

    return { orderId: res.id };
  } catch (error) {
    console.error('PayPal Checkout Error:', error);
    return { error: 'Error interno del servidor' };
  }
}

/**
 * Captura una orden de PayPal aprobada, la marca como 'finished' y extiende la suscripción.
 *
 * Garantías:
 *  - Requiere sesión activa.
 *  - Valida que el orderId pertenezca al business del usuario logueado (anti-IDOR).
 *  - Idempotente: el UPDATE filtra por `status != 'finished'`, así que doble click
 *    o retry no extienden la suscripción dos veces.
 *  - Valida el monto capturado contra el precio esperado del plan.
 *  - Replica el fulfillment de NOWPayments: plan, notificación y bono de referido.
 */
export async function capturePayPalOrderAction(orderId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Unauthorized' };

    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .single();
    if (!business) return { error: 'Business not found' };

    const supabaseAdmin = createAdminClient();

    // Verificar ownership antes de llamar a PayPal
    const { data: pendingInvoice, error: loadError } = await supabaseAdmin
      .from('saas_invoices')
      .select('business_id, status')
      .eq('np_invoice_id', orderId)
      .eq('payment_method', 'paypal')
      .single();

    if (loadError || !pendingInvoice) {
      console.error('PayPal capture: invoice not found', { orderId, loadError });
      return { error: 'Factura no encontrada' };
    }

    if (pendingInvoice.business_id !== business.id) {
      console.warn('PayPal capture: ownership mismatch', { orderId, userBusiness: business.id });
      return { error: 'No autorizado' };
    }

    if (pendingInvoice.status === 'finished') {
      return { success: true, alreadyProcessed: true };
    }

    const res = await capturePayPalOrder(orderId);
    if (res.error || res.status !== 'COMPLETED') {
      return { error: res.error || 'El pago no se completó' };
    }

    const result = await finalizePayPalPayment(supabaseAdmin, orderId, res.amount);

    switch (result.status) {
      case 'completed':
        return { success: true };
      case 'already_processed':
        return { success: true, alreadyProcessed: true };
      case 'amount_mismatch':
        console.error('PayPal capture: amount mismatch', { orderId, ...result });
        return { error: 'El monto capturado no coincide con el plan.' };
      case 'invoice_not_found':
        return { error: 'Factura no encontrada' };
      case 'db_error':
        console.error('PayPal capture: db error', { orderId, message: result.message });
        return { error: 'Pago capturado pero error al activar plan. Contacta a soporte.' };
    }
  } catch (error) {
    console.error('PayPal Capture Error:', error);
    return { error: 'Error interno durante la captura del pago' };
  }
}
