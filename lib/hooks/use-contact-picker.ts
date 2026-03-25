'use client'

/**
 * useContactPicker — hook for the native Contact Picker API.
 *
 * Handles:
 *  - Feature detection (shows button only on supported browsers)
 *  - Loading state while the native picker is open
 *  - Auto-matching the contact's phone country code to the COUNTRIES list
 *  - Calling onPick with { name, phoneLocal, country } ready to set in form state
 */

import { useState, useEffect }                    from 'react'
import { pickContact, isContactPickerSupported }  from '@/lib/services/contact-picker.service'
import { COUNTRIES, Country }                     from '@/components/ui/phone-input-flags'

export interface ContactPickResult {
  name:       string
  phoneLocal: string
  country:    Country
}

/**
 * @param onPick - called with parsed contact data when the user selects a contact
 */
export function useContactPicker(onPick: (result: ContactPickResult) => void) {
  const [supported, setSupported] = useState(false)
  const [loading,   setLoading]   = useState(false)

  // Feature detection runs client-side only
  useEffect(() => {
    setSupported(isContactPickerSupported())
  }, [])

  const pick = async () => {
    setLoading(true)
    try {
      const contact = await pickContact()
      if (!contact) return // user cancelled

      const rawPhone = (contact.phone ?? '').trim()

      // Match country by longest dial prefix
      const sorted  = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
      const matched = sorted.find(c => rawPhone.startsWith(c.dial))

      const country: Country = matched ?? (COUNTRIES[0] as Country)
      const localRaw = matched
        ? rawPhone.slice(matched.dial.length).trim()
        : rawPhone

      // Strip formatting characters from local part
      const phoneLocal = localRaw.replace(/[-.()\s]+/g, '')

      onPick({ name: contact.name, phoneLocal, country })
    } finally {
      setLoading(false)
    }
  }

  return { supported, loading, pick }
}
