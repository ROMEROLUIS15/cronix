import type { SupabaseClient } from '@supabase/supabase-js';
import { REFERRAL_BONUS_DAYS } from '@/lib/plans/plan-limits';
import type { Database } from '@/types/database.types';

type AdminClient = SupabaseClient<Database>;

export async function applyReferralBonus(
  supabaseAdmin: AdminClient,
  businessId: string,
): Promise<void> {
  const { data: biz } = await supabaseAdmin
    .from('businesses')
    .select('referred_by_id')
    .eq('id', businessId)
    .single();

  if (!biz?.referred_by_id) return;

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
    type: 'success',
  });

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const cronSecret  = process.env.CRON_SECRET;
    if (supabaseUrl && cronSecret) {
      void fetch(`${supabaseUrl}/functions/v1/push-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': cronSecret },
        body: JSON.stringify({
          business_id: referrer.id,
          title: '¡Mes gratis ganado! 🎁',
          body:  'Un negocio que invitaste activó su plan. +30 días añadidos.',
          url:   '/dashboard/settings',
          tag:   `referral-bonus-${referrer.id}-${Date.now()}`,
        }),
      }).catch(() => null);
    }
  } catch { /* fire-and-forget */ }
}

/**
 * Extiende la suscripción de forma aditiva: si todavía no ha expirado, suma 30 días
 * al `subscription_ends_at` actual; si ya expiró, parte desde hoy. Más justo para
 * quien renueva temprano que la sobrescritura desde "ahora".
 */
export function computeNextSubscriptionEnd(
  currentEndsAt: string | null,
  daysToAdd = 30,
): string {
  const now = new Date();
  const currentEnd = currentEndsAt ? new Date(currentEndsAt) : now;
  const baseDate = currentEnd > now ? currentEnd : now;
  baseDate.setDate(baseDate.getDate() + daysToAdd);
  return baseDate.toISOString();
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
 *  - Activa el plan, extiende fecha, envía notificación, aplica bono de referido.
 *
 * Compartido entre la server action (frontend onApprove) y el webhook async.
 */
export async function finalizePayPalPayment(
  supabaseAdmin: AdminClient,
  orderId: string,
  capturedAmount: number | null,
): Promise<FinalizeResult> {
  // RPC atómico: actualiza factura + business en una sola transacción con FOR UPDATE lock
  const { data, error } = await supabaseAdmin.rpc('fn_finalize_paypal_payment', {
    p_order_id: orderId,
    p_captured_amount: capturedAmount ?? 0,
    p_days: 30,
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
      // Side effects best-effort fuera de la transacción
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
      }
      await applyReferralBonus(supabaseAdmin, row.business_id);
      return { status: 'completed', invoiceId: row.invoice_id, businessId: row.business_id };
    default:
      return { status: 'db_error', message: `Unknown status: ${row.result_status}` };
  }
}
