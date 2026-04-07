import { describe, it, expect } from 'vitest'
import { routing } from '@/i18n/routing'

// ── Replicate the stripLocalePrefix logic from lib/supabase/middleware.ts ──────
// This test validates the core path-stripping behaviour that makes the Supabase
// middleware work correctly for non-default locales.
function stripLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (locale === routing.defaultLocale) continue
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1) || '/'
    }
  }
  return pathname
}

describe('stripLocalePrefix', () => {
  it('leaves default locale paths unchanged', () => {
    expect(stripLocalePrefix('/dashboard')).toBe('/dashboard')
    expect(stripLocalePrefix('/login')).toBe('/login')
    expect(stripLocalePrefix('/register')).toBe('/register')
    expect(stripLocalePrefix('/')).toBe('/')
  })

  it('strips /en prefix from paths', () => {
    expect(stripLocalePrefix('/en/dashboard')).toBe('/dashboard')
    expect(stripLocalePrefix('/en/login')).toBe('/login')
    expect(stripLocalePrefix('/en/dashboard/clients')).toBe('/dashboard/clients')
  })

  it('strips /pt prefix from paths', () => {
    expect(stripLocalePrefix('/pt/dashboard')).toBe('/dashboard')
    expect(stripLocalePrefix('/pt/dashboard/appointments/new')).toBe('/dashboard/appointments/new')
  })

  it('strips /fr, /de, /it prefix from paths', () => {
    expect(stripLocalePrefix('/fr/login')).toBe('/login')
    expect(stripLocalePrefix('/de/dashboard/settings')).toBe('/dashboard/settings')
    expect(stripLocalePrefix('/it/register')).toBe('/register')
  })

  it('handles bare locale root path', () => {
    expect(stripLocalePrefix('/en')).toBe('/')
    expect(stripLocalePrefix('/fr')).toBe('/')
  })

  it('does NOT strip /es since it is the default locale', () => {
    // /es would never appear in URLs with as-needed strategy,
    // but defensive check: es is default, so it must NOT be stripped
    expect(stripLocalePrefix('/es/dashboard')).toBe('/es/dashboard')
  })

  it('does NOT strip unrelated paths that start with locale-like segments', () => {
    // /enterprise should not be confused with /en
    expect(stripLocalePrefix('/enterprise/dashboard')).toBe('/enterprise/dashboard')
    // /denmark should not be confused with /de
    expect(stripLocalePrefix('/denmark')).toBe('/denmark')
  })

  it('handles API paths correctly', () => {
    expect(stripLocalePrefix('/api/health')).toBe('/api/health')
    expect(stripLocalePrefix('/en/api/something')).toBe('/api/something')
  })
})
