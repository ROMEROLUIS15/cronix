import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { aiCircuit } from '@/lib/ai/circuit-breaker'

export const dynamic = 'force-dynamic'

/**
 * 🩺 Health Check API
 * Provides diagnostics for uptime monitoring and system reliability.
 */
export async function GET() {
  const start = Date.now()
  const status: any = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    diagnostics: {
      database: 'down',
      environment: 'ok',
      ai_circuits: aiCircuit.getDiagnostic()
    }
  }

  try {
    // 1. Check Database connection
    const supabase = await createClient()
    const { error } = await supabase.from('users').select('count', { count: 'exact', head: true })
    if (!error) {
       status.diagnostics.database = 'connected'
    } else {
       status.status = 'degraded'
       status.diagnostics.database = `error: ${error.message}`
    }

    // 2. Check essential ENV vars
    const requiredEnv = ['LLM_API_KEY', 'DEEPGRAM_AURA_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL']
    const missing = requiredEnv.filter(key => !process.env[key])
    if (missing.length > 0) {
      status.status = 'degraded'
      status.diagnostics.environment = `missing: ${missing.join(', ')}`
    }

    const latency = Date.now() - start
    return NextResponse.json({ ...status, latency_ms: latency })

  } catch (err: any) {
    return NextResponse.json({ 
      status: 'unhealthy', 
      error: err.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
