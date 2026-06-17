import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { routing } from '@/i18n/routing'

// ── i18n key parity guard ─────────────────────────────────────────────────────
// Every locale must expose the exact same set of message keys as the source
// locale (es). A missing key means a screen falls back to the raw key (or throws)
// in that language; an extra key is dead weight / a rename left half-done.
// This test fails loudly on drift so translations stay complete across all locales.

type Json = Record<string, unknown>

function flatten(obj: Json, prefix = '', out: Record<string, true> = {}): Record<string, true> {
  for (const k of Object.keys(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    const v = obj[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Json, key, out)
    else out[key] = true
  }
  return out
}

function loadKeys(locale: string): string[] {
  const raw = readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8')
  return Object.keys(flatten(JSON.parse(raw))).sort()
}

const SOURCE = 'es'

describe('i18n message parity', () => {
  const sourceKeys = loadKeys(SOURCE)
  const targets = routing.locales.filter((l) => l !== SOURCE)

  it('source locale has keys', () => {
    expect(sourceKeys.length).toBeGreaterThan(0)
  })

  for (const locale of targets) {
    it(`${locale} has the exact same key set as ${SOURCE}`, () => {
      const keys = loadKeys(locale)
      const missing = sourceKeys.filter((k) => !keys.includes(k))
      const extra = keys.filter((k) => !sourceKeys.includes(k))
      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] })
    })
  }
})
