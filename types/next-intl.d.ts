// ── next-intl TypeScript integration ─────────────────────────────────────────
// Augments next-intl's IntlMessages interface with the full structure of
// messages/es.json (source of truth). This enables:
//   - t('nav.agenda')        → valid
//   - t('nav.inexistente')   → TypeScript compile error
//
// Requires resolveJsonModule: true (already in tsconfig.json via Next.js defaults)

import type esMessages from '../messages/es.json'

type Messages = typeof esMessages

declare global {
  interface IntlMessages extends Messages {}
}
