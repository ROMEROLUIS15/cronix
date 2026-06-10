/**
 * access-control.ts — Pure access-control decisions for the dashboard layout.
 *
 * Extracted so the redirect logic can be unit-tested directly (Constitution
 * §VI.4: business logic testable without UI). `layout.tsx` imports THIS function
 * and the test exercises THE SAME function — no re-implemented copy that could
 * silently drift from the real gate.
 */

export type AccessProfile = { business_id: string | null; role?: string | null } | null

/**
 * Whether a logged-in user must be redirected to /dashboard/setup.
 *
 * True when the user has no business_id AND is not already on /setup AND is not
 * a platform_admin (admins legitimately have no business_id). `nextUrl` is the
 * `next-url` request header; an empty value means the first load of /dashboard.
 */
export function shouldRedirectToSetup(dbUser: AccessProfile, nextUrl: string): boolean {
  const isSetupPage = nextUrl.includes('/setup') || nextUrl === ''
  const isPlatformAdmin = dbUser?.role === 'platform_admin'
  return !dbUser?.business_id && !isSetupPage && !isPlatformAdmin
}
