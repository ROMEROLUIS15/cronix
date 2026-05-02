'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { nowpayments } from '@/lib/payments/nowpayments';

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
