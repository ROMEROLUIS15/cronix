// ── VOICE JOB STATUS POLLING ENDPOINT ────────────────────────────────────────
// GET /api/assistant/voice/status?job_id=xxx
//
// Returns the current state of a background AI job.
// The frontend polls this every 750ms until status is 'completed' or 'failed'.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { jobStore } from '@/lib/ai/job-store'
import { sessionStore } from '@/lib/ai/session-store'

export const GET = withErrorHandler(async (req, _context, _supabase, user) => {
  const jobId = new URL(req.url).searchParams.get('job_id')

  if (!jobId) {
    return NextResponse.json({ error: 'Missing job_id' }, { status: 400 })
  }

  const job = await jobStore.get(jobId)

  if (!job) {
    return NextResponse.json({ error: 'Job not found or expired' }, { status: 404 })
  }

  // Ownership check — a user can only poll their own jobs
  if (job.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (job.status === 'queued' || job.status === 'processing') {
    return NextResponse.json({ status: job.status })
  }

  if (job.status === 'failed') {
    return NextResponse.json({
      status:   'failed',
      audioUrl: job.resultAudioUrl ?? null,
    })
  }

  // Completed — include text, audio, and latest session history
  const session = await sessionStore.getSession(user.id)

  return NextResponse.json({
    status:          'completed',
    text:            job.resultText ?? '',
    audioUrl:        job.resultAudioUrl ?? null,
    actionPerformed: job.actionPerformed ?? false,
    history:         session.messages,
  })
})
