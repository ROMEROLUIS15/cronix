'use client'

/**
 * VCardImport — imports a client from a .vcf file exported from the address book.
 *
 * Rendered wherever the native Contact Picker button is not, which is every
 * iPhone and every desktop browser. On iOS this is the only route to the phone's
 * contacts from a web page. See modulo-dashboard §9.
 */

import { useRef }                        from 'react'
import { ContactRound, Loader2, X }      from 'lucide-react'
import { useTranslations }               from 'next-intl'
import { useVCardImport }                from '@/lib/hooks/use-vcard-import'
import type { VCardPickResult, VCardError } from '@/lib/hooks/use-vcard-import'
import type { ParsedVCard }              from '@/lib/services/vcard.service'

/**
 * Deliberately permissive: iOS maps `accept` onto UTIs and a narrow filter
 * greys out the very file the user just saved from Contacts.
 */
const ACCEPT = '.vcf,.vcard,text/vcard,text/x-vcard,text/directory'

const ERROR_KEY: Record<VCardError, string> = {
  tooLarge:   'vcardErrorTooLarge',
  empty:      'vcardErrorEmpty',
  unreadable: 'vcardErrorUnreadable',
}

interface VCardImportProps {
  onPick: (result: VCardPickResult) => void
  /** Switches the help text to the iPhone export steps. */
  isIos?: boolean
}

export function VCardImport({ onPick, isIos = false }: VCardImportProps) {
  const t = useTranslations('common')
  const inputRef = useRef<HTMLInputElement>(null)

  const { candidates, error, loading, readFile, choose, dismiss } = useVCardImport(onPick)

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset first so re-picking the same file still fires a change event.
    e.target.value = ''
    if (file) await readFile(file)
  }

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
        style={{
          background: '#212125',
          border:     '1px solid #2E2E33',
          color:      '#F2F2F2',
        }}
      >
        {loading
          ? <Loader2 size={14} className="animate-spin" />
          : <ContactRound size={14} style={{ color: '#4D83FF' }} />
        }
        {t('vcardImport')}
      </button>

      <p className="text-xs mt-1" style={{ color: '#6A6A72' }}>
        {t(isIos ? 'vcardHintIos' : 'vcardHintDesktop')}
      </p>

      {error && (
        <p className="text-xs mt-1" style={{ color: '#FF3B30' }}>
          {t(ERROR_KEY[error])}
        </p>
      )}

      {candidates.length > 0 && (
        <ContactChooser
          contacts={candidates}
          onChoose={choose}
          onDismiss={dismiss}
        />
      )}
    </div>
  )
}

// ── Chooser ─────────────────────────────────────────────────────────────────

interface ContactChooserProps {
  contacts:  ParsedVCard[]
  onChoose:  (index: number) => void
  onDismiss: () => void
}

/** Shown only when the file carried more than one card — sharing several at once. */
function ContactChooser({ contacts, onChoose, onDismiss }: ContactChooserProps) {
  const t = useTranslations('common')

  return (
    <div
      role="listbox"
      aria-label={t('vcardChoose')}
      className="mt-2 rounded-xl overflow-hidden overflow-y-auto"
      style={{
        background: '#1A1A1F',
        border:     '1px solid #2E2E33',
        maxHeight:  '240px',
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2 text-xs font-semibold"
        style={{ color: '#909098', borderBottom: '1px solid #2E2E33' }}
      >
        {t('vcardChoose')}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('close')}
          style={{ color: '#909098' }}
        >
          <X size={14} />
        </button>
      </div>

      {contacts.map((c, i) => (
        <button
          key={`${c.name}-${c.phone ?? i}`}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onChoose(i)}
          className="w-full flex flex-col items-start px-4 py-2.5 text-left transition-colors hover:bg-white/5"
        >
          <span className="text-sm truncate w-full" style={{ color: '#F2F2F2' }}>
            {c.name || t('vcardNoName')}
          </span>
          <span className="text-xs truncate w-full" style={{ color: '#6A6A72' }}>
            {c.phone ?? t('vcardNoPhone')}
          </span>
        </button>
      ))}
    </div>
  )
}
