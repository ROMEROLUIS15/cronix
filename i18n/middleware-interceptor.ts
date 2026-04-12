import { type NextRequest } from 'next/server'
import { routing } from './routing'

/**
 * SRP: Interceptor de Peticiones para Next-Intl
 *
 * Propósito: Forzar el idioma por defecto (es) para cualquier visitante nuevo,
 * ignorando el idioma de su navegador (Accept-Language), pero respetando
 * la decisión del usuario si ya seleccionó un idioma (Cookie NEXT_LOCALE)
 * O si el locale ya viene explícito en la URL (ej. /fr/dashboard).
 */
export function enforceDefaultLocale(request: NextRequest): void {
  const hasLocaleCookie = request.cookies.has('NEXT_LOCALE')

  // Check if the URL already contains an explicit locale prefix
  // e.g. /fr/dashboard, /en/login, /pt/clients
  // next-intl with localePrefix: 'as-needed' uses prefix for non-default locales
  const pathname = request.nextUrl.pathname
  const pathSegment = pathname.split('/')[1] // First segment after /
  const urlHasExplicitLocale =
    pathSegment !== undefined &&
    pathSegment !== routing.defaultLocale &&
    routing.locales.includes(pathSegment as (typeof routing.locales)[number])

  // Only force default locale if:
  // 1. No locale cookie exists, AND
  // 2. URL does NOT already have an explicit non-default locale prefix
  if (!hasLocaleCookie && !urlHasExplicitLocale) {
    // Sobrescribimos el header de idioma nativo del navegador.
    // Esto fuerza a next-intl a resolver nuestro `defaultLocale` (Español).
    request.headers.set('accept-language', routing.defaultLocale)
  }
}
