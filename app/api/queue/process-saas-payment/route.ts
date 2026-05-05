import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { REFERRAL_BONUS_DAYS } from '@/lib/plans/plan-limits';
import { Database } from '@/types/database.types';

const supabaseAdmin = createAdminClient();

type InvoiceStatus = Database['public']['Enums']['saas_invoice_status'];

function toInvoiceStatus(paymentStatus: string): InvoiceStatus {
  switch (paymentStatus) {
    case 'waiting':     return 'waiting';
    case 'confirming':
    case 'confirmed':
    case 'sending':     return 'confirming';
    case 'partially_paid': return 'partially_paid';
    case 'finished':    return 'finished';
    case 'failed':      return 'failed';
    case 'refunded':    return 'refunded';
    case 'expired':     return 'expired';
    default:            return 'waiting';
  }
}

async function applyReferralBonus(businessId: string): Promise<void> {
  const { data: biz } = await supabaseAdmin
    .from('businesses')
    .select('referred_by_id')
    .eq('id', businessId)
    .single();

  if (!biz?.referred_by_id) return;

  // Bonus only on the first successful payment
  const { count } = await supabaseAdmin
    .from('saas_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'finished');

  if (count !== 1) return;

  const { data: referrer } = await supabaseAdmin
    .from('businesses')
    .select('id, plan, subscription_ends_at')
    .eq('id', biz.referred_by_id)
    .single();

  if (!referrer || referrer.plan === 'free') return;

  const now = new Date();
  const currentEndsAt = referrer.subscription_ends_at
    ? new Date(referrer.subscription_ends_at)
    : now;
  const baseDate = currentEndsAt > now ? currentEndsAt : now;
  baseDate.setDate(baseDate.getDate() + REFERRAL_BONUS_DAYS);

  await supabaseAdmin
    .from('businesses')
    .update({ subscription_ends_at: baseDate.toISOString(), updated_at: now.toISOString() })
    .eq('id', referrer.id);

  await supabaseAdmin.from('notifications').insert({
    business_id: referrer.id,
    title: '¡Mes gratis ganado! 🎁',
    content: 'Un negocio que invitaste ha activado su plan Pro. Hemos añadido 30 días adicionales a tu suscripción.',
    type: 'billing',
  });
}

async function handler(req: Request) {
  try {
    const payload = await req.json();
    const invoiceId     = payload.invoice_id?.toString();
    const paymentId     = payload.payment_id?.toString();
    const paymentStatus = payload.payment_status;
    const cryptoAmount  = payload.actually_paid;
    const cryptoCurrency = payload.pay_currency;

    if (!invoiceId) {
      return NextResponse.json({ error: 'Missing invoice_id' }, { status: 400 });
    }

    const invoiceStatus = toInvoiceStatus(paymentStatus);

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('saas_invoices')
      .update({
        status: invoiceStatus,
        np_payment_id: paymentId,
        crypto_amount: cryptoAmount,
        crypto_currency: cryptoCurrency,
        updated_at: new Date().toISOString(),
      })
      .eq('np_invoice_id', invoiceId)
      .select('id, business_id, plan_purchased')
      .single();

    if (invoiceError || !invoice) {
      console.error('Invoice not found or error updating:', invoiceError);
      return NextResponse.json({ error: 'Invoice update failed' }, { status: 500 });
    }

    if (invoiceStatus === 'finished') {
      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + 1);

      const { error: bizError } = await supabaseAdmin
        .from('businesses')
        .update({
          plan: invoice.plan_purchased,
          subscription_ends_at: endsAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.business_id);

      if (bizError) {
        console.error('Business update failed:', bizError);
        return NextResponse.json({ error: 'Business update failed' }, { status: 500 });
      }

      await supabaseAdmin.from('notifications').insert({
        business_id: invoice.business_id,
        title: '¡Pago Confirmado! 🎉',
        content: `Tu plan ${invoice.plan_purchased.toUpperCase()} ha sido activado exitosamente.`,
        type: 'billing',
        metadata: { invoice_id: invoice.id },
      });

      await applyReferralBonus(invoice.business_id);
    }

    if (invoiceStatus === 'partially_paid') {
      await supabaseAdmin.from('notifications').insert({
        business_id: invoice.business_id,
        title: 'Pago Incompleto (Cripto)',
        content: `Recibimos un pago parcial de ${cryptoAmount} ${cryptoCurrency?.toUpperCase()}. Contacta a soporte para completar la activación de tu plan.`,
        type: 'alert',
        metadata: { invoice_id: invoice.id, amount_received: cryptoAmount },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Queue processing error:', message);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}

// Dynamic import defers Receiver creation to request time so the build
// doesn't fail when QSTASH_* env vars are absent in CI.
async function verifiedRoute(req: Request): Promise<Response> {
  const { verifySignatureAppRouter } = await import('@upstash/qstash/dist/nextjs');
  return verifySignatureAppRouter(handler)(req);
}

export const POST = verifiedRoute;
