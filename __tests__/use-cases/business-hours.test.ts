import { describe, expect, it } from 'vitest'
import { checkBusinessHours } from '@/lib/use-cases/appointments.use-case'
import { localToUTC, outsideWorkingHours } from '../../supabase/functions/_shared/availability'

const HOURS = {
  mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'], thu: ['09:00', '18:00'],
  fri: ['10:00', '14:30'], sat: ['09:00', '13:00'], sun: null,
} as Record<string, [string, string] | null>
const CARACAS = 'America/Caracas'

const check = (date: string, time: string, durationMin: number, workingHours: typeof HOURS | null = HOURS, timezone = CARACAS) =>
  checkBusinessHours({ workingHours, timezone, start: new Date(localToUTC(date, time, timezone)), durationMin })

describe('checkBusinessHours', () => {
  it('accepts an appointment that starts at opening and ends exactly at closing', () => {
    expect(check('2026-11-04', '09:00', 540)).toBeNull()
  })

  it('refuses a start before opening and gives the hours of that day', () => {
    expect(check('2026-11-06', '09:30', 30)).toEqual({ closed: false, open: '10:00', close: '14:30' })
  })

  it('refuses an appointment that starts inside the hours and ends after closing', () => {
    expect(check('2026-11-04', '17:30', 60)).toEqual({ closed: false, open: '09:00', close: '18:00' })
  })

  it('refuses a day without hours as closed', () => {
    expect(check('2026-11-08', '10:00', 30)).toEqual({ closed: true })
  })

  it('reads the day and the time in the timezone of the business', () => {
    // 2026-11-07 01:00 UTC is still Friday 21:00 in Caracas, not Saturday.
    const start = new Date('2026-11-07T01:00:00Z')
    expect(checkBusinessHours({ workingHours: HOURS, timezone: CARACAS, start, durationMin: 30 }))
      .toEqual({ closed: false, open: '10:00', close: '14:30' })
  })

  it('uses 09:00 to 18:00 every day for a business that never set its hours', () => {
    expect(check('2026-11-08', '10:00', 30, null)).toBeNull()
    expect(check('2026-11-08', '19:00', 30, {})).toEqual({ closed: false, open: '09:00', close: '18:00' })
  })

  it('gives the same answer as the rule the voice and the agents use', () => {
    const inputs: Array<[string, string, number, typeof HOURS | null, string]> = []
    const dates = ['2026-11-04', '2026-11-06', '2026-11-07', '2026-11-08']
    const times = ['00:00', '08:59', '09:00', '09:30', '10:00', '12:45', '13:00', '14:00', '17:30', '18:00', '23:30']
    for (const timezone of [CARACAS, 'America/Bogota', 'Europe/Madrid', 'Asia/Tokyo', 'UTC']) {
      for (const workingHours of [HOURS, null]) {
        for (const date of dates) for (const time of times) for (const duration of [15, 60, 240]) {
          inputs.push([date, time, duration, workingHours, timezone])
        }
      }
    }
    for (const [date, time, durationMin, workingHours, timezone] of inputs) {
      expect(check(date, time, durationMin, workingHours, timezone), `${date} ${time} ${durationMin} ${timezone}`)
        .toEqual(outsideWorkingHours({ workingHours, date, time, durationMin, timezone }))
    }
  })
})
