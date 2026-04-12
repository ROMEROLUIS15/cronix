import { type NextRequest, NextResponse } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from '@/i18n/routing'
import { updateSession } from '@/lib/supabase/middleware'
import { enforceDefaultLocale } from '@/i18n/middleware-interceptor'

// ── 1. Inicialización de Handlers ─────────────────────────────────────────────
const intlMiddleware = createIntlMiddleware(routing)

function isNonLocalizedRoute(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname.startsWith('/auth/')
}

// Routes that handle their own auth via withErrorHandler — skip middleware updateSession
// to avoid redundant Supabase auth calls (~100-200ms savings per request)
function isSelfAuthedApi(pathname: string): boolean {
  return pathname.startsWith('/api/assistant/')
}

// ── 2. Función Helper de Fusión (SOLID: SRP) ──────────────────────────────────
/**
 * Fusiona las cabeceras y cookies de la respuesta de Supabase hacia la de Next-Intl
 * para que Next.js reciba ambas capas arquitectónicas de forma unificada.
 */
function mergeMiddlewareResponses(intlResponse: NextResponse, supabaseResponse: NextResponse): void {
  // Copiar cookies de sesión
  for (const cookie of supabaseResponse.headers.getSetCookie()) {
    intlResponse.headers.append('set-cookie', cookie)
  }

  // Fusionar overrides de cabeceras
  const intlOverrides = intlResponse.headers.get('x-middleware-override-headers') ?? ''
  const supabaseOverrides = supabaseResponse.headers.get('x-middleware-override-headers') ?? ''
  if (supabaseOverrides) {
    const merged = intlOverrides ? `${intlOverrides},${supabaseOverrides}` : supabaseOverrides
    intlResponse.headers.set('x-middleware-override-headers', merged)
  }

  // Copiar otras cabeceras modificadas (RSC compat)
  supabaseResponse.headers.forEach((value, key) => {
    if (key.startsWith('x-middleware-request-') && !intlResponse.headers.has(key)) {
      intlResponse.headers.set(key, value)
    }
  })
}

// ── 3. Cadena de Responsabilidad Principal (Middleware) ───────────────────────
export async function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID()
  const { pathname } = request.nextUrl

  // A. Rutas bypass (API/Auth puras)
  if (isNonLocalizedRoute(pathname)) {
    // Self-authed APIs (e.g. /api/assistant/*) handle their own auth via withErrorHandler
    // Skip updateSession to avoid redundant Supabase auth call (~100-200ms saved)
    if (isSelfAuthedApi(pathname)) {
      const response = NextResponse.next()
      response.headers.set('x-request-id', requestId)
      return response
    }
    const response = await updateSession(request)
    response.headers.set('x-request-id', requestId)
    return response
  }

  // B. Interceptor de Idioma (Fuerza Español si no hay cookie de preferencia)
  enforceDefaultLocale(request)

  // C. Ejecución de Next-Intl
  const intlResponse = intlMiddleware(request)

  // Si Next-Intl necesita redirigir (ej. /es/dashboard -> /dashboard) abortamos temprano
  if (intlResponse.status === 307 || intlResponse.status === 308) {
    intlResponse.headers.set('x-request-id', requestId)
    return intlResponse
  }

  // D. Ejecución de Supabase Auth
  const supabaseResponse = await updateSession(request)

  // Si Supabase redirige (ej. expiró sesión), preservar la cookie de idioma en el salto
  if (supabaseResponse.status === 307 || supabaseResponse.status === 308) {
    for (const cookie of intlResponse.headers.getSetCookie()) {
      supabaseResponse.headers.append('set-cookie', cookie)
    }
    supabaseResponse.headers.set('x-request-id', requestId)
    return supabaseResponse
  }

  // E. Ensamblaje Final de Capas
  mergeMiddlewareResponses(intlResponse, supabaseResponse)
  intlResponse.headers.set('x-request-id', requestId)

  return intlResponse
}

export const config = {
  matcher: [
    // next-intl: all page requests except static files and Next.js internals
    '/((?!_next|_vercel|.*\\..*).*)',
    // Supabase rate-limiting and session refresh on API routes
    '/api/:path*',
  ],
}

