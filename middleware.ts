import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID()
  const response = await updateSession(request)
  
  // Inject ID for traceability across logs and services
  response.headers.set('x-request-id', requestId)
  
  return response
}

export const config = {
  matcher: [
    '/api/:path*',
    '/dashboard/:path*',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ],
}