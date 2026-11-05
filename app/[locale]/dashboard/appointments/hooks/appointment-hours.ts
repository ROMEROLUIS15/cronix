import { checkBusinessHours, type StoredWorkingHours } from '@/lib/use-cases/appointments.use-case'

export interface BusinessHours {
  workingHours: StoredWorkingHours
  timezone:     string
}

type Translate = (key: 'closedDay' | 'outsideBusinessHours', values?: { open: string; close: string }) => string

/** The stored hours of the business. Without a timezone, the time the owner sees in the form. */
export function businessHoursFrom(data: { settings: Record<string, unknown> | null; timezone: string | null }): BusinessHours {
  return {
    workingHours: data.settings?.workingHours as StoredWorkingHours,
    timezone:     data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

/** Why this time cannot be booked; null when it fits, or when the hours could not be read. */
export function hoursError(t: Translate, hours: BusinessHours | null, start: Date, durationMin: number): string | null {
  if (!hours) return null
  const outside = checkBusinessHours({ ...hours, start, durationMin })
  if (!outside) return null
  return outside.closed ? t('closedDay') : t('outsideBusinessHours', { open: outside.open, close: outside.close })
}
