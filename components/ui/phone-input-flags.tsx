'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Users, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

// ── Types ──────────────────────────────────────────────────────────────────
export type Country = {
  code:        string
  flag:        string
  name:        string
  dial:        string
  placeholder: string
}

// ── Data ───────────────────────────────────────────────────────────────────
export const COUNTRIES: Country[] = [
  { code: 'VE', flag: '🇻🇪', name: 'Venezuela',       dial: '+58',   placeholder: '412 000 0000'  },
  { code: 'CO', flag: '🇨🇴', name: 'Colombia',        dial: '+57',   placeholder: '300 123 4567'  },
  { code: 'MX', flag: '🇲🇽', name: 'México',          dial: '+52',   placeholder: '55 1234 5678'  },
  { code: 'US', flag: '🇺🇸', name: 'Estados Unidos',  dial: '+1',    placeholder: '212 555 1234'  },
  { code: 'AR', flag: '🇦🇷', name: 'Argentina',       dial: '+54',   placeholder: '11 2345 6789'  },
  { code: 'CL', flag: '🇨🇱', name: 'Chile',           dial: '+56',   placeholder: '9 8765 4321'   },
  { code: 'PE', flag: '🇵🇪', name: 'Perú',            dial: '+51',   placeholder: '912 345 678'   },
  { code: 'EC', flag: '🇪🇨', name: 'Ecuador',         dial: '+593',  placeholder: '99 123 4567'   },
  { code: 'UY', flag: '🇺🇾', name: 'Uruguay',         dial: '+598',  placeholder: '91 234 567'    },
  { code: 'BO', flag: '🇧🇴', name: 'Bolivia',         dial: '+591',  placeholder: '7 123 4567'    },
  { code: 'PY', flag: '🇵🇾', name: 'Paraguay',        dial: '+595',  placeholder: '981 234 567'   },
  { code: 'ES', flag: '🇪🇸', name: 'España',          dial: '+34',   placeholder: '612 345 678'   },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil',          dial: '+55',   placeholder: '11 91234 5678' },
  { code: 'PA', flag: '🇵🇦', name: 'Panamá',          dial: '+507',  placeholder: '6123 4567'     },
  { code: 'DO', flag: '🇩🇴', name: 'Rep. Dominicana', dial: '+1809', placeholder: '809 123 4567'  },
]

// ── Helpers ────────────────────────────────────────────────────────────────
const DEFAULT_COUNTRY = COUNTRIES[0] as Country

/**
 * Parses a stored phone string like "+58 412 000 0000"
 * into its country and local number parts.
 * Falls back to Venezuela (default) if no prefix is recognized.
 */
export function parsePhone(
  phone: string | null | undefined
): { country: Country; local: string } {
  if (!phone) return { country: DEFAULT_COUNTRY, local: '' }

  // Sort by dial length descending to match longest prefix first (+1809 before +1)
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
  const found  = sorted.find(c => phone.startsWith(c.dial + ' ') || phone.startsWith(c.dial))

  if (found) {
    const local = phone.replace(found.dial, '').trim()
    return { country: found, local }
  }

  return { country: DEFAULT_COUNTRY, local: phone }
}

/**
 * Combines a country dial code and a local number into a full phone string.
 * Returns null if localPhone is empty.
 */
export function buildPhone(country: Country, localPhone: string): string | null {
  const trimmed = localPhone.trim()
  return trimmed ? `${country.dial} ${normalizeLocal(country.dial, trimmed)}` : null
}

/**
 * Strips dial-code prefix (if user typed it), dashes, extra spaces,
 * and leading zeros from the local part.
 * Stored format is always: "+XX 1234567890" (no leading 0 in local part).
 */
function normalizeLocal(dial: string, local: string): string {
  let clean = local
  // Remove accidental leading dial code (e.g. user typed "+58 424...")
  if (clean.startsWith(dial)) clean = clean.slice(dial.length)
  // Strip any leading "+" and dial-like prefix (e.g. user typed "+57 316...")
  clean = clean.replace(/^\+\d+\s*/, '')
  // Remove dashes, dots, parentheses, and collapse spaces → pure digits
  clean = clean.replace(/[-.()\s]+/g, '')
  // Strip leading zeros — local numbers must not include the trunk prefix (e.g. 0 in 04247092980)
  clean = clean.replace(/^0+/, '')
  return clean
}

/**
 * Returns true if the stored phone starts with a recognized international dial code.
 * A false result means the number is in legacy local format (no country code)
 * and should be corrected by the user in the edit form.
 */
export function isE164Phone(phone: string | null | undefined): boolean {
  if (!phone) return true
  return COUNTRIES.some(c => phone.startsWith(c.dial))
}

// ── Props ──────────────────────────────────────────────────────────────────
interface PhoneInputFlagsProps {
  country:           Country
  onCountryChange:   (country: Country) => void
  localPhone:        string
  onLocalPhoneChange:(val: string) => void
  /** Shows the "saved as" hint below the input. Default: true */
  showHint?:         boolean
  /** If provided, shows a contact-picker button next to the input */
  onPickContact?:    () => void
  /** Shows a loading spinner on the contact-picker button */
  pickContactLoading?: boolean
}

// ── Component ──────────────────────────────────────────────────────────────
export function PhoneInputFlags({
  country,
  onCountryChange,
  localPhone,
  onLocalPhoneChange,
  showHint = true,
  onPickContact,
  pickContactLoading = false,
}: PhoneInputFlagsProps) {
  const t = useTranslations('common')
  const [open,        setOpen]       = useState(false)
  const dropdownRef                  = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div>
      <div className="flex gap-2">

        {/* ── Country picker ─────────────────────────────────────────────── */}
        <div className="relative flex-shrink-0" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-label={t('selectCountry')}
            aria-expanded={open}
            className="flex items-center gap-1.5 h-full px-3 rounded-xl text-sm font-semibold transition-all"
            style={{
              background:  '#212125',
              border:      '1px solid #2E2E33',
              color:       '#F2F2F2',
              minWidth:    '90px',
              boxShadow:   open ? '0 0 0 2px rgba(0,98,255,0.3)' : 'none',
            }}
          >
            <span className="text-lg leading-none">{country.flag}</span>
            <span style={{ color: '#4D83FF', fontSize: '12px', fontWeight: 700 }}>
              {country.dial}
            </span>
            <ChevronDown
              size={12}
              aria-hidden
              style={{
                color:      '#909098',
                transform:  open ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </button>

          {open && (
            <div
              role="listbox"
              aria-label={t('country')}
              className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden overflow-y-auto"
              style={{
                background:  '#1A1A1F',
                border:      '1px solid #2E2E33',
                boxShadow:   '0 8px 30px rgba(0,0,0,0.5)',
                maxHeight:   '240px',
                minWidth:    'min(220px, calc(100vw - 2rem))',
              }}
            >
              {COUNTRIES.map(c => (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={country.code === c.code}
                  onClick={() => { onCountryChange(c); setOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-white/5"
                  style={{
                    background: country.code === c.code ? 'rgba(0,98,255,0.1)' : 'transparent',
                    color:      country.code === c.code ? '#4D83FF'             : '#F2F2F2',
                  }}
                >
                  <span className="text-xl leading-none">{c.flag}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs font-bold flex-shrink-0" style={{ color: '#4D83FF' }}>
                    {c.dial}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Local number input ─────────────────────────────────────────── */}
        <input
          type="tel"
          value={localPhone}
          onChange={e => onLocalPhoneChange(e.target.value)}
          placeholder={country.placeholder}
          className="input-base flex-1"
          autoComplete="tel-national"
        />

        {/* ── Contact picker button (mobile only) ────────────────────────── */}
        {onPickContact && (
          <button
            type="button"
            onClick={onPickContact}
            disabled={pickContactLoading}
            aria-label="Seleccionar de contactos"
            title="Importar desde agenda"
            className="flex items-center justify-center rounded-xl transition-all flex-shrink-0"
            style={{
              background: '#0062FF',
              border:     '1px solid rgba(0,98,255,0.6)',
              color:      '#fff',
              width:      '42px',
              height:     '42px',
              boxShadow:  '0 0 10px rgba(0,98,255,0.35)',
            }}
          >
            {pickContactLoading
              ? <Loader2 size={17} className="animate-spin" />
              : <Users size={17} />
            }
          </button>
        )}
      </div>

      {/* ── Hint ─────────────────────────────────────────────────────────── */}
      {showHint && (
        <p className="text-xs mt-1" style={{ color: '#6A6A72' }}>
          {t('savedAs')}: {country.dial} {localPhone || country.placeholder}
        </p>
      )}
    </div>
  )
}
