/** Cronix brand default — matches --primary in globals.css */
const CRONIX_PRIMARY_HSL = '220 100% 50%'

/**
 * Converts a 6-digit hex color string to the "H S% L%" format expected by
 * Tailwind's hsl(var(--primary)) CSS variable system.
 *
 * Returns the Cronix default for null/undefined/invalid input so that
 * tenants without a custom brand color always fall back gracefully.
 */
export function hexToHsl(hex: string | null | undefined): string {
  if (!hex) return CRONIX_PRIMARY_HSL

  const match = /^#([0-9A-Fa-f]{6})$/.exec(hex.trim())
  if (!match || !match[1]) return CRONIX_PRIMARY_HSL

  const hex6 = match[1]
  const r = parseInt(hex6.slice(0, 2), 16) / 255
  const g = parseInt(hex6.slice(2, 4), 16) / 255
  const b = parseInt(hex6.slice(4, 6), 16) / 255

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
