'use server';

import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * Approves a manual payment: sets invoice to 'finished',
 * upgrades the business plan, and notifies the business owner.
 */
export async function approveManualPayment(
  invoiceId: string,
  adminNote?: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Unauthorized' };

    // Verify the caller is an admin
    const { data: caller } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    if (!caller || caller.role !== 'platform_admin') return { error: 'Forbidden' };

    const supabaseAdmin = createAdminClient();

    // Fetch the invoice
    const { data: invoice, error: fetchError } = await supabaseAdmin
      .from('saas_invoices')
      .update({
        status: 'finished',
        admin_notes: adminNote ?? 'Aprobado manualmente.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .select('id, business_id, plan_purchased')
      .single();

    if (fetchError || !invoice) {
      console.error('[Admin] Approve error:', fetchError);
      return { error: 'No se encontró la factura o ya fue procesada.' };
    }

    // Upgrade business plan
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
      console.error('[Admin] Business update error:', bizError);
      return { error: 'Error al actualizar el plan del negocio.' };
    }

    // Notify the business
    await supabaseAdmin.from('notifications').insert({
      business_id: invoice.business_id,
      title: '¡Pago Confirmado! 🎉',
      content: `Tu plan ${invoice.plan_purchased.toUpperCase()} ha sido activado exitosamente. ¡Bienvenido!`,
      type: 'success',
      metadata: { invoice_id: invoice.id },
    });

    return { success: true };
  } catch (err) {
    console.error('[Admin] Unexpected error in approveManualPayment:', err);
    return { error: 'Error interno.' };
  }
}

/**
 * Rejects a manual payment: sets invoice to 'failed' and notifies the business.
 */
export async function rejectManualPayment(
  invoiceId: string,
  reason: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Unauthorized' };

    const { data: caller } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    if (!caller || caller.role !== 'platform_admin') return { error: 'Forbidden' };

    const supabaseAdmin = createAdminClient();

    const { data: invoice, error: updateError } = await supabaseAdmin
      .from('saas_invoices')
      .update({
        status: 'failed',
        admin_notes: reason || 'Rechazado por el administrador.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .select('id, business_id, plan_purchased')
      .single();

    if (updateError || !invoice) {
      console.error('[Admin] Reject error:', updateError);
      return { error: 'No se encontró la factura.' };
    }

    // Notify the business
    await supabaseAdmin.from('notifications').insert({
      business_id: invoice.business_id,
      title: 'Pago No Verificado',
      content: `No pudimos verificar tu pago manual. Razón: ${reason}. Contáctanos si crees que es un error.`,
      type: 'error',
      metadata: { invoice_id: invoice.id },
    });

    return { success: true };
  } catch (err) {
    console.error('[Admin] Unexpected error in rejectManualPayment:', err);
    return { error: 'Error interno.' };
  }
}
