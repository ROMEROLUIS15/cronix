/**
 * Color utilities for tenant branding.
 */

const CRONIX_PRIMARY_HSL = '220 100% 50%'
const CRONIX_PRIMARY_RGB = '0, 98, 255'

function parseHex(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null
  const match = /^#([0-9A-Fa-f]{6})$/.exec(hex.trim())
  if (!match || !match[1]) return null
  const hex6 = match[1]
  return [
    parseInt(hex6.slice(0, 2), 16),
    parseInt(hex6.slice(2, 4), 16),
    parseInt(hex6.slice(4, 6), 16),
  ]
}

/**
 * Converts a 6-digit hex string to "H S% L%" for hsl(var(--primary)).
 * Returns Cronix default for null/undefined/invalid input.
 */
export function hexToHsl(hex: string | null | undefined): string {
  const rgb = parseHex(hex)
  if (!rgb) return CRONIX_PRIMARY_HSL

  const r = rgb[0] / 255
  const g = rgb[1] / 255
  const b = rgb[2] / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r)      h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else                h = (r - g) / delta + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/**
 * Converts a 6-digit hex string to "R, G, B" for rgba(var(--primary-rgb), opacity).
 * Returns Cronix default for null/undefined/invalid input.
 */
export function hexToRgb(hex: string | null | undefined): string {
  const rgb = parseHex(hex)
  if (!rgb) return CRONIX_PRIMARY_RGB
  return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`
}
