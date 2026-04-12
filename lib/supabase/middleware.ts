/**
 * lib/supabase/middleware.ts — Backward-compat re-export.
 *
 * All imports from '@/lib/supabase/middleware' still work.
 * New code should import from '@/lib/middleware' directly.
 *
 * @deprecated Import from '@/lib/middleware' instead.
 */

export { updateSession } from './middleware-session'
