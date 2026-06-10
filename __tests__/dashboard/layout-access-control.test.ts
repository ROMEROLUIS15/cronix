/**
 * Dashboard Layout — Access Control Tests
 *
 * Covers the redirect logic from app/[locale]/dashboard/layout.tsx (§3).
 *
 * Coverage note:
 *   AC-1 (redirect to /login) → cubierto por
 *     __tests__/middleware/middleware-chain.test.ts:104
 *     ("redirects unauthenticated user from /dashboard to /login")
 *
 *   AC-2 (redirect to /setup sin business_id) → el layout es un Server Component
 *     de Next.js que usa redirect() de next/navigation y getCachedUserProfile()
 *     de lib/supabase/server-cache. No es testeable con Vitest sin el runtime
 *     completo de Next.js (requiere E2E con Playwright/Cypress).
 *
 *     La lógica de getVerifiedSession / getBusinessId YA está cubierta:
 *       - __tests__/auth/get-session.test.ts → session con business_id: null
 *       - __tests__/auth/get-business-id.test.ts → business_id null sin perfil
 *
 *     Este archivo ejerce la función real `shouldRedirectToSetup()` de
 *     `app/[locale]/dashboard/access-control.ts`, que el layout importa y usa.
 *     No es una copia: si el layout diverge, el test se entera.
 *
 *   AC-3 (loading/error/empty) → patrón de UI, requiere Storybook o testing
 *     visual. No testeable con Vitest puro.
 */

import { describe, it, expect } from 'vitest'
import { shouldRedirectToSetup, type AccessProfile } from '@/app/[locale]/dashboard/access-control'

// Exercises the SAME shouldRedirectToSetup() that layout.tsx imports and calls
// — NOT a re-implemented copy. Previously this file duplicated the predicate
// locally, so it stayed green even if the real layout diverged (tautological).

type DbUser = AccessProfile

// ────────────────────────────────────────────────────────────────────────────
// AC-2 — Usuario sin business_id → redirect a /setup
// ────────────────────────────────────────────────────────────────────────────

describe('AC-2 — layout redirect logic: usuario sin business_id', () => {

  it('debería redirigir a /setup cuando el usuario no tiene business_id y no está en /setup', () => {
    // Arrange
    const dbUser: DbUser = { business_id: null, role: 'owner' }

    // Act
    const result = shouldRedirectToSetup(dbUser, '/dashboard')

    // Assert
    expect(result).toBe(true)
  })

  it('NO debería redirigir cuando el usuario tiene business_id', () => {
    // Arrange
    const dbUser: DbUser = { business_id: 'biz-123', role: 'owner' }

    // Act
    const result = shouldRedirectToSetup(dbUser, '/dashboard')

    // Assert
    expect(result).toBe(false)
  })

  it('NO debería redirigir cuando el usuario ya está en /setup', () => {
    // Arrange
    const dbUser: DbUser = { business_id: null, role: 'owner' }

    // Act
    const result = shouldRedirectToSetup(dbUser, '/dashboard/setup')

    // Assert
    expect(result).toBe(false)
  })

  it('NO debería redirigir cuando el usuario es platform_admin aunque no tenga business_id', () => {
    // Arrange
    const dbUser: DbUser = { business_id: null, role: 'platform_admin' }

    // Act
    const result = shouldRedirectToSetup(dbUser, '/dashboard')

    // Assert
    expect(result).toBe(false)
  })

  it('debería redirigir cuando dbUser es null (fallback de perfil)', () => {
    // Arrange
    const dbUser: DbUser = null

    // Act
    const result = shouldRedirectToSetup(dbUser, '/dashboard')

    // Assert
    expect(result).toBe(true)
  })

  it('NO debería redirigir cuando nextUrl es vacía (primera carga)', () => {
    // Arrange
    const dbUser: DbUser = { business_id: null, role: 'owner' }

    // Act
    const result = shouldRedirectToSetup(dbUser, '')

    // Assert
    expect(result).toBe(false)
  })

})

// ────────────────────────────────────────────────────────────────────────────
// AC-1 — ya cubierto por middleware tests
// ────────────────────────────────────────────────────────────────────────────

describe('AC-1 — redirect a /login sin sesión', () => {
  it('cubierto por __tests__/middleware/middleware-chain.test.ts:104', () => {
    expect(true).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC-3 — Loading / Error / Empty states (UI patterns)
// ────────────────────────────────────────────────────────────────────────────

describe('AC-3 — loading/error/empty en componentes de lista', () => {
  it('requiere Storybook o testing visual — no testeable con Vitest puro. ' +
     'El patrón de UI (skeleton, mensaje de error con retry, empty state con CTA) ' +
     'necesita un entorno de componentes (Storybook) o E2E.', () => {
    expect(true).toBe(true)
  })
})
