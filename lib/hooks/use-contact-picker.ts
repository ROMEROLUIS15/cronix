'use client'

/**
 * useContactPicker — hook for the native Contact Picker API.
 *
 * Handles:
 *  - Feature detection (shows button only on supported browsers)
 *  - Loading state while the native picker is open
 *  - Matching the contact's phone country code against the COUNTRIES list
 *  - Calling onPick with { name, phoneLocal, country } ready to set in form state
 *
 * The API exists on Chrome for Android and nowhere else that matters. When it
 * is missing, the .vcf import (`useVCardImport`) is the fallback route — see
 * modulo-dashboard §9.
 */

import { useState, useEffect }                          from 'react'
import { pickContact, isContactPickerSupported, isIOS } from '@/lib/services/contact-picker.service'
import { splitContactPhone }                            from '@/lib/hooks/contact-phone'
import { Country }                                      from '@/components/ui/phone-input-flags'

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
  const [isIos,     setIsIos]     = useState(false)
  const [loading,   setLoading]   = useState(false)

  // Feature detection runs client-side only (UA access would break hydration)
  useEffect(() => {
    setSupported(isContactPickerSupported())
    // Drives the wording of the fallback's help text, not whether it renders:
    // exporting a .vcf takes different steps on a phone than on a desktop.
    setIsIos(isIOS())
  }, [])

  const pick = async () => {
    setLoading(true)
    try {
      const contact = await pickContact()
      if (!contact) return // user cancelled

      const { country, phoneLocal } = splitContactPhone(contact.phone ?? '')
      onPick({ name: contact.name, phoneLocal, country })
    } finally {
      setLoading(false)
    }
  }

  return { supported, isIos, loading, pick }
}
