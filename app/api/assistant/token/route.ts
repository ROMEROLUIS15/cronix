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
    // 1. Fetch the Deepgram Project ID associated with the API Key
    const projectsRes = await fetch('https://api.deepgram.com/v1/projects', {
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`
      }
    })
    
    if (!projectsRes.ok) {
      throw new Error('Could not fetch Deepgram projects')
    }
    
    const { projects } = await projectsRes.json()
    const deepgramProjectId = projects[0]?.project_id
    
    if (!deepgramProjectId) {
      throw new Error('No Deepgram projects found for this key')
    }

    // 2. We call Deepgram's Key API to create a temporary key
    // This key is scoped to 'usage:client' and has a short TTL (5 mins)
    const response = await fetch(`https://api.deepgram.com/v1/projects/${deepgramProjectId}/keys`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        comment: `Temp key for user ${user.id}`,
        scopes: ['usage:client'], // MUST be usage:client for WebSockets
        tags: ['voice-assistant'],
        time_to_live_in_seconds: 1800 // 30 minutes — prevents mid-session expiry
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
      projectId: deepgramProjectId 
    })

  } catch (err: any) {
    logger.error('DEEPGRAM-TOKEN', `Critical error: ${err.message}`)
    return NextResponse.json({ error: 'Internal gateway error' }, { status: 500 })
  }
})
