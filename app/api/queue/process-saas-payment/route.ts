import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendReferralBonusPush } from '@/lib/payments/subscription-fulfillment';
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

    // RPC atómico: factura + business + bono de referido en una sola transacción.
    // Cierra la ventana post-commit que perdía el bono (H1-bis).
    const { data, error } = await supabaseAdmin.rpc('fn_finalize_crypto_payment', {
      p_np_invoice_id:   invoiceId,
      p_np_payment_id:   paymentId ?? null,
      p_status:          invoiceStatus,
      p_crypto_amount:   cryptoAmount ?? null,
      p_crypto_currency: cryptoCurrency ?? null,
      p_days:            REFERRAL_BONUS_DAYS,
    });

    if (error) {
      console.error('Crypto finalize RPC failed:', error.message);
      return NextResponse.json({ error: 'Finalize failed' }, { status: 500 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return NextResponse.json({ error: 'RPC returned no rows' }, { status: 500 });
    }

    switch (row.result_status) {
      case 'invoice_not_found':
        console.error('Invoice not found:', invoiceId);
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

      case 'already_processed':
        return NextResponse.json({ success: true, idempotent: true });

      case 'completed':
        // Side effects best-effort fuera de la TX (notif in-app + push externos).
        // El plan y el bono ya quedaron persistidos atómicamente en el RPC.
        await supabaseAdmin.from('notifications').insert({
          business_id: row.business_id,
          title: '¡Pago Confirmado! 🎉',
          content: `Tu plan ${row.plan_purchased.toUpperCase()} ha sido activado exitosamente.`,
          type: 'success',
          metadata: { invoice_id: row.invoice_id, payment_method: 'nowpayments' },
        });
        if (row.referral_bonus_applied && row.referrer_business_id) {
          sendReferralBonusPush(row.referrer_business_id);
        }
        return NextResponse.json({ success: true });

      case 'updated':
        if (row.invoice_status === 'partially_paid') {
          await supabaseAdmin.from('notifications').insert({
            business_id: row.business_id,
            title: 'Pago Incompleto (Cripto)',
            content: `Recibimos un pago parcial de ${cryptoAmount} ${cryptoCurrency?.toUpperCase()}. Contacta a soporte para completar la activación de tu plan.`,
            type: 'warning',
            metadata: { invoice_id: row.invoice_id, amount_received: cryptoAmount },
          });
        }
        return NextResponse.json({ success: true });

      default:
        console.error('Unknown finalize status:', row.result_status);
        return NextResponse.json({ error: 'Unknown status' }, { status: 500 });
    }
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
