'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { nowpayments } from '@/lib/payments/nowpayments';

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

    const amountUsd = plan === 'pro' ? 6.00 : 10.00;

    // Call NOWPayments
    // order_id must be unique per invoice — append timestamp to avoid NOWPayments rejecting duplicates
    const orderId = `${business.id}-${Date.now()}`;

    const res = await nowpayments.createInvoice({
      price_amount: amountUsd,
      price_currency: 'usd',
      pay_currency: 'usdttrc20',
      order_id: orderId,
      order_description: `cronix-${plan}`,
      success_url: `${process.env.APP_URL}/es/dashboard/settings?payment=success`,
      cancel_url: `${process.env.APP_URL}/es/dashboard/settings?payment=cancel`
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
