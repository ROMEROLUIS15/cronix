/**
 * vCard Service — parses .vcf files exported from a device address book.
 *
 * This is the only route that reaches the phone's contact list on iOS: WebKit
 * does not implement the Contact Picker API, and Safari's AutoFill fills the
 * user's OWN card ("My Info"), never an arbitrary contact. See modulo-dashboard §9.
 *
 * Targets vCard 3.0 — what iOS Contacts exports — and tolerates the two other
 * shapes that show up in real exports: 2.1 (quoted-printable, Android/Outlook)
 * and 4.0 (`tel:` / `mailto:` URI values).
 *
 * Pure: no DOM, no React, no network. Everything risky about the feature lives
 * here so it can be tested in isolation.
 *
 * Specs: RFC 6350 (4.0), RFC 2426 (3.0), Versit vCard 2.1.
 */

export interface ParsedVCard {
  name:  string
  phone: string | null
  email: string | null
}

interface VCardLine {
  /** Uppercased property name with any Apple group prefix ("item1.") stripped. */
  prop:   string
  /** Uppercased raw parameters, e.g. ['TYPE=CELL', 'PREF']. */
  params: string[]
  value:  string
}

/** Large base64 blobs we never read — dropping them early keeps parsing cheap. */
const SKIPPED_PROPS = new Set(['PHOTO', 'LOGO', 'SOUND', 'KEY'])

// ── Line handling ───────────────────────────────────────────────────────────

/**
 * Joins continuation lines back onto their property line.
 *
 * Two folding schemes exist and both appear in the wild:
 *  - RFC (2.1/3.0/4.0): the continuation line starts with a space or tab.
 *  - Quoted-printable (2.1): the value ends with "=" and the next line is raw.
 *
 * The QP case is applied only when the line declares that encoding, because a
 * trailing "=" is also valid base64 padding.
 */
function unfoldLines(raw: string): string[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []

  for (const line of lines) {
    const prev = out[out.length - 1]

    if (prev !== undefined && /^[ \t]/.test(line)) {
      out[out.length - 1] = prev + line.slice(1)
      continue
    }
    if (prev !== undefined && prev.endsWith('=') && /QUOTED-PRINTABLE/i.test(prev)) {
      out[out.length - 1] = prev.slice(0, -1) + line
      continue
    }
    out.push(line)
  }

  return out
}

/** Groups lines into cards. Content outside a BEGIN/END pair is ignored. */
function splitCards(lines: string[]): string[][] {
  const cards: string[][] = []
  let current: string[] | null = null

  for (const line of lines) {
    const marker = line.trim().toUpperCase()

    if (marker === 'BEGIN:VCARD') { current = []; continue }
    if (marker === 'END:VCARD')   { if (current) cards.push(current); current = null; continue }

    if (current) current.push(line)
  }

  return cards
}

/** `item1.TEL;type=CELL:+58 412…` → { prop:'TEL', params:['TYPE=CELL'], value:'+58 412…' } */
function parseLine(line: string): VCardLine | null {
  const colon = line.indexOf(':')
  if (colon === -1) return null

  const segments = line.slice(0, colon).split(';')
  const rawProp  = segments[0]
  if (!rawProp) return null

  // Apple prefixes grouped properties with "item1.", "item2.", …
  const prop = (rawProp.split('.').pop() ?? '').trim().toUpperCase()
  if (!prop) return null

  return {
    prop,
    params: segments.slice(1).map(p => p.trim().toUpperCase()),
    value:  line.slice(colon + 1),
  }
}

// ── Value decoding ──────────────────────────────────────────────────────────

/** Decodes `=C3=A9` style escapes back to UTF-8 text. */
function decodeQuotedPrintable(input: string): string {
  const bytes: number[] = []

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? ''

    if (ch === '=' && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16))
        i += 2
        continue
      }
    }
    // Anything not encoded is ASCII by definition of the encoding.
    bytes.push(ch.charCodeAt(0))
  }

  return new TextDecoder('utf-8').decode(Uint8Array.from(bytes))
}

/** vCard text escapes: `\n` / `\N` (newline), `\,`, `\;`, `\\`. */
function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, ch: string) =>
    ch === 'n' || ch === 'N' ? '\n' : ch,
  )
}

function decodeRaw(line: VCardLine): string {
  return line.params.some(p => p.includes('QUOTED-PRINTABLE'))
    ? decodeQuotedPrintable(line.value)
    : line.value
}

function decodeValue(line: VCardLine): string {
  return unescapeText(decodeRaw(line)).trim()
}

/**
 * Splits a structured value on its unescaped ";" separators.
 *
 * Written as a scan rather than a lookbehind regex on purpose: lookbehind only
 * reached Safari in 16.4, and a SyntaxError here would take down the whole
 * bundle chunk on exactly the iOS versions this feature exists to serve.
 */
function splitStructured(value: string): string[] {
  const parts: string[] = []
  let buffer = ''

  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? ''

    if (ch === '\\' && i + 1 < value.length) { buffer += ch + (value[i + 1] ?? ''); i++; continue }
    if (ch === ';')                          { parts.push(buffer); buffer = ''; continue }

    buffer += ch
  }
  parts.push(buffer)

  return parts.map(p => unescapeText(p).trim())
}

// ── Field selection ─────────────────────────────────────────────────────────

const hasParam = (line: VCardLine, token: string) => line.params.some(p => p.includes(token))

/**
 * FN is the display name and is mandatory from 3.0 on. Some 2.1 exports carry
 * only N (`Last;First;Middle;Prefix;Suffix`), so it is rebuilt in reading order.
 */
function pickName(lines: VCardLine[]): string {
  const fn = lines.find(l => l.prop === 'FN')
  if (fn) {
    const value = decodeValue(fn)
    if (value) return value
  }

  const n = lines.find(l => l.prop === 'N')
  if (!n) return ''

  const [last = '', first = '', middle = '', prefix = '', suffix = ''] =
    splitStructured(decodeRaw(n))

  return [prefix, first, middle, last, suffix].filter(Boolean).join(' ')
}

/**
 * Preference order: mobile, then the card's preferred number, then the first
 * listed. A client's mobile is what the WhatsApp agent needs, so CELL wins.
 */
function pickPhone(lines: VCardLine[]): string | null {
  const tels = lines.filter(l => l.prop === 'TEL')

  const chosen =
    tels.find(l => hasParam(l, 'CELL') || hasParam(l, 'MOBILE')) ??
    tels.find(l => hasParam(l, 'PREF')) ??
    tels[0]

  if (!chosen) return null

  // vCard 4.0 writes TEL values as a `tel:` URI.
  return decodeValue(chosen).replace(/^tel:/i, '').trim() || null
}

function pickEmail(lines: VCardLine[]): string | null {
  const emails = lines.filter(l => l.prop === 'EMAIL')
  const chosen = emails.find(l => hasParam(l, 'PREF')) ?? emails[0]
  if (!chosen) return null

  return decodeValue(chosen).replace(/^mailto:/i, '').trim() || null
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Parses every card in a .vcf file.
 *
 * Cards carrying neither a name nor a phone are dropped: they hold nothing the
 * client form can use, and offering them as choices would only be noise.
 */
export function parseVCards(text: string): ParsedVCard[] {
  return splitCards(unfoldLines(text))
    .map(card => {
      const lines = card
        .map(parseLine)
        .filter((l): l is VCardLine => l !== null && !SKIPPED_PROPS.has(l.prop))

      return {
        name:  pickName(lines),
        phone: pickPhone(lines),
        email: pickEmail(lines),
      }
    })
    .filter(c => c.name !== '' || c.phone !== null)
}
