/**
 * Splits a phone number coming from a device address book into the shape the
 * client form stores: a country from COUNTRIES plus the local part.
 *
 * Shared by BOTH import routes — the native Contact Picker (Android) and the
 * .vcf import (iOS/desktop) — so a contact lands identically whichever door it
 * came through. See modulo-dashboard §9.
 *
 * Lives beside its two consumers rather than in `lib/services/` because it
 * depends on the COUNTRIES table, which is exported from the UI component.
 * Pure and free of React, but not free of that import.
 */

import { COUNTRIES, Country } from '@/components/ui/phone-input-flags'

export interface SplitPhone {
  country:    Country
  phoneLocal: string
}

/**
 * Falls back to the first country when no dial prefix matches — a local-format
 * number keeps its digits and the user corrects the flag if it guessed wrong.
 */
export function splitContactPhone(rawPhone: string): SplitPhone {
  const phone = rawPhone.trim()

  // Longest dial prefix first, so +1809 matches before +1.
  const sorted  = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
  const matched = sorted.find(c => phone.startsWith(c.dial))

  const localRaw = matched ? phone.slice(matched.dial.length) : phone

  return {
    country:    matched ?? (COUNTRIES[0] as Country),
    phoneLocal: localRaw.replace(/[-.()\s]+/g, '').trim(),
  }
}
