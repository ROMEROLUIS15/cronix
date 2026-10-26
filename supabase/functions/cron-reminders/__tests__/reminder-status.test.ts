/**
 * reminder-status.test.ts — What the reminder cron writes to and reads from
 * `appointment_reminders`.
 *
 * BUG (prod, found 2026-10-26): the sender upserted with onConflict 'appointment_id',
 * but the only unique index on that column is partial (WHERE channel = 'push_owner'),
 * so Postgres rejected every write and nobody checked the error. No WhatsApp reminder
 * was marked sent after 2026-03-23 (727 rows still 'pending').
 *
 * Marking them sent must not skip an appointment that was rescheduled after its
 * reminder: the reminder invites the client to reschedule (operacion-canonica R2) and
 * nothing deletes the 'sent' row when the date changes.
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getSkippedReminderIds, recordReminderOutcome } from '../modules/reminder-status.ts'

type Row = Record<string, unknown>
type Op =
  | { kind: 'select' }
  | { kind: 'update'; values: Row }
  | { kind: 'insert'; values: Row }
  | { kind: 'upsert'; values: Row; onConflict?: string }

/**
 * In-memory `appointment_reminders` with the prod constraints: `id` is the only
 * full unique index, so ON CONFLICT (appointment_id) fails the way it does in prod.
 */
function fakeDb(rows: Row[], failWith?: string) {
  function query() {
    const filters: Array<(r: Row) => boolean> = []
    let op: Op = { kind: 'select' }
    let returning = false

    function run() {
      if (failWith) return { data: null, error: { message: failWith } }
      const matched = rows.filter((r) => filters.every((f) => f(r)))
      switch (op.kind) {
        case 'select':
          return { data: matched.map((r) => ({ ...r })), error: null }
        case 'update':
          for (const r of matched) Object.assign(r, op.values)
          return { data: returning ? matched.map((r) => ({ id: r.id })) : null, error: null }
        case 'insert':
          rows.push({ id: `rem-${rows.length + 1}`, minutes_before: 60, ...op.values })
          return { data: null, error: null }
        case 'upsert':
          if (op.onConflict && op.onConflict !== 'id') {
            return {
              data: null,
              error: { code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' },
            }
          }
          rows.push({ id: `rem-${rows.length + 1}`, minutes_before: 60, ...op.values })
          return { data: null, error: null }
      }
    }

    const builder = {
      select() { if (op.kind !== 'select') returning = true; return builder },
      eq(column: string, value: unknown) { filters.push((r) => r[column] === value); return builder },
      neq(column: string, value: unknown) { filters.push((r) => r[column] !== value); return builder },
      in(column: string, values: unknown[]) { filters.push((r) => values.includes(r[column])); return builder },
      update(values: Row) { op = { kind: 'update', values }; return builder },
      insert(values: Row) { op = { kind: 'insert', values }; return builder },
      upsert(values: Row, opts?: { onConflict?: string }) { op = { kind: 'upsert', values, onConflict: opts?.onConflict }; return builder },
      then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return builder
  }

  return {
    from(table: string) {
      expect(table).toBe('appointment_reminders')
      return query()
    },
  } as unknown as SupabaseClient
}

const BIZ = 'biz-1'
const NOW = new Date('2026-10-31T00:00:05Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const scheduledByDashboard = (overrides: Row = {}): Row => ({
  id: 'rem-dash', appointment_id: 'apt-1', business_id: BIZ, channel: 'whatsapp',
  status: 'pending', remind_at: '2026-10-31T00:00:00Z', minutes_before: 0,
  sent_at: null, error_message: null, ...overrides,
})

describe('recordReminderOutcome', () => {
  it('marks the reminder the dashboard scheduled as sent', async () => {
    const rows = [scheduledByDashboard()]

    const result = await recordReminderOutcome(fakeDb(rows), {
      appointmentId: 'apt-1', businessId: BIZ, delivered: true, now: NOW.toISOString(),
    })

    expect(result).toEqual({ success: true })
    expect(rows).toEqual([scheduledByDashboard({ status: 'sent', sent_at: NOW.toISOString() })])
  })

  it('records a failed delivery on that same row', async () => {
    const rows = [scheduledByDashboard()]

    const result = await recordReminderOutcome(fakeDb(rows), {
      appointmentId: 'apt-1', businessId: BIZ, delivered: false, now: NOW.toISOString(),
    })

    expect(result).toEqual({ success: true })
    expect(rows).toEqual([scheduledByDashboard({ status: 'failed', error_message: 'WhatsApp delivery failed' })])
  })

  it('creates the WhatsApp row when the appointment had none, leaving the owner push row alone', async () => {
    const ownerPush: Row = {
      id: 'rem-push', appointment_id: 'apt-1', business_id: BIZ, channel: 'push_owner',
      status: 'sent', remind_at: hoursAgo(30), minutes_before: 60, sent_at: hoursAgo(30), error_message: null,
    }
    const rows = [{ ...ownerPush }]

    const result = await recordReminderOutcome(fakeDb(rows), {
      appointmentId: 'apt-1', businessId: BIZ, delivered: true, now: NOW.toISOString(),
    })

    expect(result).toEqual({ success: true })
    expect(rows).toEqual([
      ownerPush,
      {
        id: 'rem-2', appointment_id: 'apt-1', business_id: BIZ, channel: 'whatsapp', minutes_before: 60,
        status: 'sent', remind_at: NOW.toISOString(), sent_at: NOW.toISOString(), error_message: null,
      },
    ])
  })

  it('returns the database error instead of swallowing it', async () => {
    const result = await recordReminderOutcome(fakeDb([scheduledByDashboard()], 'connection reset'), {
      appointmentId: 'apt-1', businessId: BIZ, delivered: true, now: NOW.toISOString(),
    })

    expect(result).toEqual({ success: false, error: 'connection reset' })
  })
})

describe('getSkippedReminderIds', () => {
  const skipped = (rows: Row[]) => getSkippedReminderIds(fakeDb(rows), BIZ, ['apt-1'], NOW)

  it('skips an appointment already reminded tonight (the cron fired twice)', async () => {
    expect(await skipped([scheduledByDashboard({ status: 'sent', sent_at: hoursAgo(1) })])).toEqual(new Set(['apt-1']))
  })

  it('skips an appointment whose reminder was cancelled', async () => {
    expect(await skipped([scheduledByDashboard({ status: 'cancelled' })])).toEqual(new Set(['apt-1']))
  })

  it('reminds again an appointment rescheduled after its reminder for another day', async () => {
    expect(await skipped([scheduledByDashboard({ status: 'sent', sent_at: hoursAgo(24) })])).toEqual(new Set())
  })

  it('does not take the owner imminent push of a rescheduled appointment for a client reminder', async () => {
    // Appointment was today at 10:00 (owner pushed at 9:00), then moved to tomorrow.
    const ownerPush = scheduledByDashboard({ channel: 'push_owner', status: 'sent', sent_at: hoursAgo(11) })
    expect(await skipped([ownerPush])).toEqual(new Set())
  })

  it('throws on a database error so the caller can report it', async () => {
    await expect(getSkippedReminderIds(fakeDb([], 'timeout'), BIZ, ['apt-1'], NOW)).rejects.toThrow('timeout')
  })
})
