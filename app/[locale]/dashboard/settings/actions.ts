'use server';

import { createClient } from '@/lib/supabase/server';
import { nowpayments } from '@/lib/payments/nowpayments';

export async function createSaaSCheckoutSession(plan: 'pro' | 'enterprise') {
  try {
    const supabase = createClient();
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
    const res = await nowpayments.createInvoice({
      price_amount: amountUsd,
      price_currency: 'usd',
      pay_currency: 'usdttrc20', // Obligar pago en USDT Tron para evitar comisiones altas
      order_id: business.id,
      order_description: plan,
      success_url: `${process.env.APP_URL}/es/dashboard/settings?payment=success`,
      cancel_url: `${process.env.APP_URL}/es/dashboard/settings?payment=cancel`
    });

    if (res.error || !res.invoice_url || !res.invoice_id) {
      return { error: res.error || 'Could not generate payment link' };
    }

    // Guardar el pre-registro de la factura
    const { error: insertError } = await supabase
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
