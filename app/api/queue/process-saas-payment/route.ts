import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database.types';

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function handler(req: Request) {
  try {
    const payload = await req.json();
    const invoiceId = payload.invoice_id?.toString();
    const paymentId = payload.payment_id?.toString();
    const paymentStatus = payload.payment_status;
    const cryptoAmount = payload.actually_paid;
    const cryptoCurrency = payload.pay_currency;

    if (!invoiceId) {
      return NextResponse.json({ error: 'Missing invoice_id' }, { status: 400 });
    }

    // Normalizar el estado de NOWPayments a nuestro Enum de base de datos
    let invoiceStatus: Database['public']['Enums']['saas_invoice_status'] = 'waiting';
    switch (paymentStatus) {
      case 'waiting': invoiceStatus = 'waiting'; break;
      case 'confirming': 
      case 'confirmed': 
      case 'sending': invoiceStatus = 'confirming'; break;
      case 'partially_paid': invoiceStatus = 'partially_paid'; break;
      case 'finished': invoiceStatus = 'finished'; break;
      case 'failed': invoiceStatus = 'failed'; break;
      case 'refunded': invoiceStatus = 'refunded'; break;
      case 'expired': invoiceStatus = 'expired'; break;
      default: invoiceStatus = 'waiting';
    }

    // 1. Actualizar el estado de la factura
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('saas_invoices')
      .update({
        status: invoiceStatus,
        np_payment_id: paymentId,
        crypto_amount: cryptoAmount,
        crypto_currency: cryptoCurrency,
        updated_at: new Date().toISOString()
      })
      .eq('np_invoice_id', invoiceId)
      .select('id, business_id, plan_purchased')
      .single();

    if (invoiceError || !invoice) {
      console.error('Invoice not found or error updating:', invoiceError);
      return NextResponse.json({ error: 'Invoice update failed' }, { status: 500 });
    }

    // 2. Si el pago finalizó correctamente, actualizar el plan del negocio
    if (invoiceStatus === 'finished') {
      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + 1); // Suscripción de 1 mes (30 días aprox)

      const { error: bizError } = await supabaseAdmin
        .from('businesses')
        .update({
          plan: invoice.plan_purchased,
          subscription_ends_at: endsAt.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', invoice.business_id);

      if (bizError) {
        console.error('Business update failed:', bizError);
        return NextResponse.json({ error: 'Business update failed' }, { status: 500 });
      }

      // Crear notificación de éxito
      await supabaseAdmin.from('notifications').insert({
        business_id: invoice.business_id,
        title: '¡Pago Confirmado! 🎉',
        content: `Tu plan ${invoice.plan_purchased.toUpperCase()} ha sido activado exitosamente.`,
        type: 'billing',
        metadata: { invoice_id: invoice.id }
      });
    }

    // 3. Manejo de pagos parciales (Cripto-Caos)
    if (invoiceStatus === 'partially_paid') {
      await supabaseAdmin.from('notifications').insert({
        business_id: invoice.business_id,
        title: 'Pago Incompleto (Cripto)',
        content: `Recibimos un pago parcial de ${cryptoAmount} ${cryptoCurrency?.toUpperCase()}. Contacta a soporte para completar la activación de tu plan.`,
        type: 'alert',
        metadata: { invoice_id: invoice.id, amount_received: cryptoAmount }
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Queue processing error:', err);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}

// Dynamic import defers Receiver creation to request time so the build
// doesn't fail when QSTASH_* env vars are absent in CI.
async function verifiedRoute(req: Request): Promise<Response> {
  const { verifySignatureAppRouter } = await import('@upstash/qstash/dist/nextjs')
  return verifySignatureAppRouter(handler)(req)
}

export const POST = verifiedRoute;
