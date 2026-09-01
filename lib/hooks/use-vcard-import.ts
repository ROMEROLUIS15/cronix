'use client'

/**
 * useVCardImport — imports a contact from a .vcf file the user picked.
 *
 * The fallback route wherever the Contact Picker API is missing, which is every
 * iPhone (WebKit never shipped it) and every desktop browser. On iOS this is
 * the ONLY way to reach the address book from a web page. See modulo-dashboard §9.
 *
 * A shared file can hold several cards, so selection is a two-step flow: read
 * the file, then choose. A single-card file skips the choice.
 */

import { useState }            from 'react'
import { parseVCards }         from '@/lib/services/vcard.service'
import type { ParsedVCard }    from '@/lib/services/vcard.service'
import { splitContactPhone }   from '@/lib/hooks/contact-phone'
import { Country }             from '@/components/ui/phone-input-flags'

export interface VCardPickResult {
  name:       string
  phoneLocal: string
  country:    Country
  email:      string | null
}

/** Message keys under `common.vcard*`, so the hook stays free of copy. */
export type VCardError = 'tooLarge' | 'empty' | 'unreadable'

/** Generous for a handful of cards with photos, still bounded. */
const MAX_FILE_BYTES = 5 * 1024 * 1024

function toResult(card: ParsedVCard): VCardPickResult {
  const { country, phoneLocal } = splitContactPhone(card.phone ?? '')
  return { name: card.name, phoneLocal, country, email: card.email }
}

export function useVCardImport(onPick: (result: VCardPickResult) => void) {
  const [candidates, setCandidates] = useState<ParsedVCard[]>([])
  const [error,      setError]      = useState<VCardError | null>(null)
  const [loading,    setLoading]    = useState(false)

  const dismiss = () => { setCandidates([]); setError(null) }

  const readFile = async (file: File) => {
    setLoading(true)
    setCandidates([])
    setError(null)

    try {
      if (file.size > MAX_FILE_BYTES) { setError('tooLarge'); return }

      const cards = parseVCards(await file.text())
      const only  = cards[0]

      if (!only)             { setError('empty'); return }
      if (cards.length === 1) { onPick(toResult(only)); return }

      setCandidates(cards)
    } catch {
      // Unreadable file, cancelled read, or a decoder that rejected the bytes.
      setError('unreadable')
    } finally {
      setLoading(false)
    }
  }

  const choose = (index: number) => {
    const card = candidates[index]
    if (!card) return

    onPick(toResult(card))
    dismiss()
  }

  return { candidates, error, loading, readFile, choose, dismiss }
}
