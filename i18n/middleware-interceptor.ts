import { type NextRequest } from 'next/server'
import { routing } from './routing'

/**
 * SRP: Interceptor de Peticiones para Next-Intl
 * 
 * Propósito: Forzar el idioma por defecto (es) para cualquier visitante nuevo,
 * ignorando el idioma de su navegador (Accept-Language), pero respetando
 * la decisión del usuario si ya seleccionó un idioma (Cookie NEXT_LOCALE).
 */
export function enforceDefaultLocale(request: NextRequest): void {
  const hasLocaleCookie = request.cookies.has('NEXT_LOCALE')

  if (!hasLocaleCookie) {
    // Sobrescribimos el header de idioma nativo del navegador.
    // Esto fuerza a next-intl a resolver nuestro `defaultLocale` (Español).
    request.headers.set('accept-language', routing.defaultLocale)
  }
}
