import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

// ── Locale-aware navigation primitives ───────────────────────────────────────
// Import Link, redirect, useRouter, usePathname from HERE — never from 'next/navigation'
// directly in UI components. This ensures locale prefix is handled automatically.
//
// Key behaviour of usePathname: returns path WITHOUT locale prefix
// e.g. on /en/dashboard it returns '/dashboard' — active-state checks work unchanged.

export const { Link, redirect, useRouter, usePathname, getPathname } =
  createNavigation(routing)
