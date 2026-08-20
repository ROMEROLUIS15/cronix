/**
 * Contact Picker Service — wrapper for the browser Contact Picker API.
 *
 * The Contact Picker API is supported on Chrome (Android) and some
 * mobile browsers. Falls back gracefully when unavailable.
 *
 * Spec: https://wicg.github.io/contact-api/spec/
 */

export interface PickedContact {
  name:  string
  phone: string | null
}

/**
 * Returns true if the current browser supports the Contact Picker API.
 * Must be called on the client side only.
 */
export function isContactPickerSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'contacts' in navigator &&
    // @ts-expect-error — ContactsManager not in TS lib yet
    typeof navigator.contacts?.select === 'function'
  )
}

/**
 * Returns true on iOS / iPadOS.
 *
 * WebKit gates the Contact Picker API behind an experimental flag that is off
 * by default, so `isContactPickerSupported()` is false on every iPhone browser.
 * Safari offers a different route instead — "AutoFill Contact" → "Other
 * Contact" in the keyboard bar — which the UI can point the user to.
 *
 * Kept separate from the unsupported case on purpose: desktop browsers also
 * lack the API, but have no such keyboard flow to fall back on.
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false

  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as "Macintosh"; touch points disambiguate it.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
}

/**
 * Opens the device's native contact picker and returns the selected contact.
 * Returns null if the user cancels, the API is unsupported, or an error occurs.
 */
export async function pickContact(): Promise<PickedContact | null> {
  if (!isContactPickerSupported()) return null

  try {
    // @ts-expect-error — ContactsManager not in TS lib yet
    const results = await navigator.contacts.select(['name', 'tel'], {
      multiple: false,
    })

    if (!results || results.length === 0) return null

    const contact = results[0]
    const name    = (contact.name?.[0] as string | undefined) ?? ''
    const phone   = (contact.tel?.[0]  as string | undefined) ?? null

    return { name: name.trim(), phone }
  } catch {
    // User cancelled or API error
    return null
  }
}
