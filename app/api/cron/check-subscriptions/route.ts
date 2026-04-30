import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database.types';

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function handler(req: Request) {
  try {
    const now = new Date().toISOString();

    // Buscar todos los negocios cuyo plan sea distinto a free y que su suscripción ya haya expirado
    const { data: expiredBusinesses, error: fetchError } = await supabaseAdmin
      .from('businesses')
      .select('id, plan, subscription_ends_at')
      .neq('plan', 'free')
      .lt('subscription_ends_at', now);

    if (fetchError) {
      console.error('Error fetching expired subscriptions:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }

    if (!expiredBusinesses || expiredBusinesses.length === 0) {
      return NextResponse.json({ success: true, downgraded: 0, message: 'No subscriptions to downgrade' });
    }

    // Downgradear a todos a 'free'
    const businessIds = expiredBusinesses.map(b => b.id);
    
    const { error: updateError } = await supabaseAdmin
      .from('businesses')
      .update({
        plan: 'free',
        updated_at: new Date().toISOString()
      })
      .in('id', businessIds);

    if (updateError) {
      console.error('Error downgrading subscriptions:', updateError);
      return NextResponse.json({ error: 'Failed to downgrade' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      downgraded: businessIds.length,
      businesses: businessIds 
    });
  } catch (err: any) {
    console.error('Cron job error:', err);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}

// Dynamic import defers Receiver creation to request time so the build
// doesn't fail when QSTASH_* env vars are absent in CI.
async function verifiedRoute(req: Request): Promise<Response> {
  const { verifySignatureAppRouter } = await import('@upstash/qstash/dist/nextjs')
  return verifySignatureAppRouter(handler)(req)
}

export const GET = verifiedRoute;
export const POST = verifiedRoute;
