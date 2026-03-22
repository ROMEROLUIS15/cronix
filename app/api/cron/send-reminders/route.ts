/**
 * Cron endpoint — Send WhatsApp appointment reminders.
 *
 * Called by Vercel Cron Jobs (see vercel.json).
 * Secured with the CRON_SECRET environment variable.
 *
 * Flow:
 *  1. Query appointment_reminders WHERE status='pending' AND remind_at <= now
 *  2. For each, send WhatsApp template message
 *  3. Mark as sent or failed
 *
 * Required env vars:
 *   CRON_SECRET                — shared secret configured in Vercel
 *   WHATSAPP_PHONE_NUMBER_ID   — Meta Business Manager phone ID
 *   WHATSAPP_ACCESS_TOKEN      — Meta access token
 *   SUPABASE_SERVICE_ROLE_KEY  — to bypass RLS for cross-tenant queries
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }          from '@/lib/supabase/server'
import { sendAppointmentReminder }    from '@/lib/services/whatsapp.service'
import {
  getPendingReminders,
  markReminderSent,
  markReminderFailed,
} from '@/lib/repositories/reminders.repo'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Fetch due reminders ─────────────────────────────────────────────────
  const supabase = createAdminClient()
  const reminders = await getPendingReminders(supabase).catch(err => {
    console.error('[cron] getPendingReminders failed:', err)
    return []
  })

  if (reminders.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0, skipped: 0 })
  }

  const results = { sent: 0, failed: 0, skipped: 0 }

  // ── Process each reminder ───────────────────────────────────────────────
  for (const reminder of reminders) {
    const apt = reminder.appointments

    if (!apt) {
      results.skipped++
      continue
    }

    const client   = apt.clients
    const business = apt.businesses

    if (!client?.phone) {
      // No phone on file — cancel silently
      await markReminderFailed(supabase, reminder.id, 'Client has no phone number')
      results.skipped++
      continue
    }

    const startDate = new Date(apt.start_at)
    const date = startDate.toLocaleDateString('es-CO', {
      weekday: 'long',
      day:     'numeric',
      month:   'long',
      year:    'numeric',
    })
    const time = startDate.toLocaleTimeString('es-CO', {
      hour:   '2-digit',
      minute: '2-digit',
    })

    const result = await sendAppointmentReminder({
      to:           client.phone,
      clientName:   client.name,
      businessName: business?.name ?? 'su negocio',
      date,
      time,
    })

    if (result.success) {
      await markReminderSent(supabase, reminder.id)
      results.sent++
    } else {
      await markReminderFailed(supabase, reminder.id, result.error ?? 'Unknown error')
      results.failed++
    }
  }

  return NextResponse.json({
    ok:        true,
    processed: reminders.length,
    ...results,
  })
}
