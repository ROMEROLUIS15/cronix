import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { logger } from '@/lib/logger'

// ── CONFIG ───────────────────────────────────────────────────────────────
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_AURA_API_KEY

/**
 * GET /api/assistant/token
 * Security: Only authenticated users can request a temporary token.
 */
export const GET = withErrorHandler(async (req, _context, _supabase, user) => {
  if (!DEEPGRAM_API_KEY) {
    return NextResponse.json({ error: 'Deepgram is not configured' }, { status: 500 })
  }

  try {
    // We call Deepgram's Key API to create a temporary key
    // This key is scoped to 'usage:client' and has a short TTL (5 mins)
    const response = await fetch('https://api.deepgram.com/v1/projects/psuthbtdvprojdbsimvq/keys', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        comment: `Temp key for user ${user.id}`,
        scopes: ['usage:runtime'],
        tags: ['voice-assistant'],
        time_to_live_in_seconds: 300 // 5 minutes
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      logger.error('DEEPGRAM-TOKEN', `Failed to generate token: ${errText}`)
      throw new Error('Could not generate temporary access token')
    }

    const data = await response.json()
    
    return NextResponse.json({ 
      token: data.key,
      projectId: 'psuthbtdvprojdbsimvq' 
    })

  } catch (err: any) {
    logger.error('DEEPGRAM-TOKEN', `Critical error: ${err.message}`)
    return NextResponse.json({ error: 'Internal gateway error' }, { status: 500 })
  }
})
