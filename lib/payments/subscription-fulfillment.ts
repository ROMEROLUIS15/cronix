import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { REFERRAL_BONUS_DAYS } from '@/lib/plans/plan-limits';

type AdminClient = SupabaseClient<Database>;

/**
 * Push best-effort al referidor avisando del bono ganado.
 * El registro in-app de la notificación ya quedó persistido atómicamente dentro
 * de fn_apply_referral_bonus; esto es solo el Web Push (llamada externa, nunca
 * transaccional), por lo que es fire-and-forget por diseño.
 */
export function sendReferralBonusPush(referrerId: string): void {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const cronSecret  = process.env.CRON_SECRET;
    if (supabaseUrl && cronSecret) {
      void fetch(`${supabaseUrl}/functions/v1/push-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': cronSecret },
        body: JSON.stringify({
          business_id: referrerId,
          title: '¡Mes gratis ganado! 🎁',
          body:  `Un negocio que invitaste activó su plan. +${REFERRAL_BONUS_DAYS} días añadidos.`,
          url:   '/dashboard/settings',
          tag:   `referral-bonus-${referrerId}-${Date.now()}`,
        }),
      }).catch(() => null);
    }
  } catch { /* fire-and-forget */ }
}

type FinalizeResult =
  | { status: 'completed'; invoiceId: string; businessId: string }
  | { status: 'already_processed' }
  | { status: 'amount_mismatch'; expected: number; captured: number | null }
  | { status: 'invoice_not_found' }
  | { status: 'db_error'; message: string };

/**
 * Finaliza una factura de PayPal de forma idempotente:
 *  - Valida monto capturado vs precio del plan.
 *  - UPDATE con `neq status finished` → optimistic lock contra carreras.
 *  - Activa el plan, extiende fecha, aplica el bono de referido — TODO en una
 *    sola transacción (fn_finalize_paypal_payment). El bono ya no queda en una
 *    ventana post-commit donde un fallo de Node lo perdía irreversiblemente.
 *
 * Compartido entre la server action (frontend onApprove) y el webhook async.
 */
export async function finalizePayPalPayment(
  supabaseAdmin: AdminClient,
  orderId: string,
  capturedAmount: number | null,
): Promise<FinalizeResult> {
  // RPC atómico: factura + business + bono de referido en una transacción con FOR UPDATE lock
  const { data, error } = await supabaseAdmin.rpc('fn_finalize_paypal_payment', {
    p_order_id: orderId,
    p_captured_amount: capturedAmount ?? 0,
    p_days: REFERRAL_BONUS_DAYS,
  });

  if (error) {
    return { status: 'db_error', message: error.message };
  }

  const row = Array.isArray(data) ? data[0]! : data;
  if (!row) {
    return { status: 'db_error', message: 'RPC returned no rows' };
  }

  switch (row.result_status) {
    case 'invoice_not_found':
      return { status: 'invoice_not_found' };
    case 'amount_mismatch':
      return { status: 'amount_mismatch', expected: 0, captured: capturedAmount };
    case 'already_processed':
      return { status: 'already_processed' };
    case 'completed':
      // Side effects best-effort fuera de la transacción (push externo no transaccional).
      // La notificación in-app del pago y el bono de referido ya quedaron persistidos
      // atómicamente dentro del RPC.
      {
        const { error: notifError } = await supabaseAdmin.from('notifications').insert({
          business_id: row.business_id,
          title: '¡Pago Confirmado! 🎉',
          content: `Tu plan ${row.plan_purchased.toUpperCase()} ha sido activado exitosamente.`,
          type: 'success',
          metadata: { invoice_id: row.invoice_id, payment_method: 'paypal' },
        });
        if (notifError) {
          console.error('[Fulfillment] Notification insert failed:', notifError);
        }
        // Web push to owner — server-to-server with CRON_SECRET
        try {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
          const cronSecret  = process.env.CRON_SECRET;
          if (supabaseUrl && cronSecret) {
            void fetch(`${supabaseUrl}/functions/v1/push-notify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-secret': cronSecret },
              body: JSON.stringify({
                business_id: row.business_id,
                title: '¡Pago Confirmado! 🎉',
                body:  `Tu plan ${row.plan_purchased.toUpperCase()} ha sido activado.`,
                url:   '/dashboard/settings',
                tag:   `payment-${row.invoice_id}`,
              }),
            }).catch(() => null);
          }
        } catch { /* fire-and-forget */ }

        // Push best-effort al referidor (el bono ya fue aplicado dentro del RPC).
        if (row.referral_bonus_applied && row.referrer_business_id) {
          sendReferralBonusPush(row.referrer_business_id);
        }
      }
      return { status: 'completed', invoiceId: row.invoice_id, businessId: row.business_id };
    default:
      return { status: 'db_error', message: `Unknown status: ${row.result_status}` };
  }
}
