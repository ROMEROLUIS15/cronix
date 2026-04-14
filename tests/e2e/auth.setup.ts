/**
 * auth.setup.ts — Playwright Auth Setup
 *
 * Authenticates via the Supabase REST API directly, bypassing the Next.js
 * Server Action login form. This is more reliable because:
 * - Server Actions + Turbopack + @sentry/nextjs on Next.js 14 can hang
 * - REST auth is fast, deterministic, and independent of UI rendering
 *
 * After obtaining a session token, we inject it into the Playwright browser
 * context as the `sb-*-auth-token` cookie that @supabase/ssr expects.
 *
 * Usage: configured as "setup" project in playwright.config.ts
 * Output: playwright/.auth/user.json (gitignored)
 */

import { test as setup, expect } from '@playwright/test'
import path from 'path'

const AUTH_FILE = path.join(__dirname, '../../playwright/.auth/user.json')

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? ''
const SUPABASE_ANON    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const TEST_EMAIL       = process.env.E2E_TEST_EMAIL               ?? ''
const TEST_PASSWORD    = process.env.E2E_TEST_PASSWORD            ?? ''
const BASE_URL         = process.env.PLAYWRIGHT_BASE_URL          ?? 'http://localhost:3000'

if (!SUPABASE_URL || !SUPABASE_ANON || !TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error(
    'Missing E2E env vars. Ensure .env.local has:\n' +
    '  NEXT_PUBLIC_SUPABASE_URL\n' +
    '  NEXT_PUBLIC_SUPABASE_ANON_KEY\n' +
    '  E2E_TEST_EMAIL\n' +
    '  E2E_TEST_PASSWORD'
  )
}

// Extract project ref from URL: https://<ref>.supabase.co
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase/)?.[1] ?? ''

setup('authenticate as E2E test user', async ({ page, context }) => {
  // ── Step 1: Authenticate via Supabase REST API ───────────────────────────
  // This bypasses the Next.js login form entirely — no Server Actions needed.
  // Retry with backoff to handle transient DNS errors (EAI_AGAIN).
  let tokenRes: Awaited<ReturnType<typeof page.request.post>> | null = null
  const MAX_RETRIES = 3

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      tokenRes = await page.request.post(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          headers: {
            'apikey':       SUPABASE_ANON,
            'Content-Type': 'application/json',
          },
          data: { email: TEST_EMAIL, password: TEST_PASSWORD },
          timeout: 10_000,
        }
      )
      break // success — exit retry loop
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_RETRIES && (msg.includes('EAI_AGAIN') || msg.includes('fetch failed') || msg.includes('ENOTFOUND'))) {
        const waitMs = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s
        console.log(`⚠️  Auth attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${msg}). Retrying in ${waitMs}ms...`)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
      throw err // non-retryable error — fail fast
    }
  }

  if (!tokenRes) throw new Error('Auth request failed after all retries')

  expect(tokenRes.ok(), `Auth API failed: ${tokenRes.status()} ${await tokenRes.text()}`).toBeTruthy()

  const session = await tokenRes.json() as {
    access_token:  string
    refresh_token: string
    expires_at:    number
    token_type:    string
    user:          { id: string; email: string }
  }

  expect(session.access_token, 'access_token missing from auth response').toBeTruthy()

  // ── Step 2: Inject the session cookie into the browser context ────────────
  // @supabase/ssr expects the session stored as cookie `sb-<ref>-auth-token`
  // The value is a JSON-encoded session object (same shape as signInWithPassword returns).
  const cookieValue = JSON.stringify({
    access_token:  session.access_token,
    token_type:    session.token_type    ?? 'bearer',
    expires_in:    3600,
    expires_at:    session.expires_at,
    refresh_token: session.refresh_token,
    user:          session.user,
  })

  const cookieName = `sb-${projectRef}-auth-token`

  // Navigate to the app first so the cookie domain is set correctly
  await page.goto(BASE_URL)

  await context.addCookies([
    {
      name:     cookieName,
      value:    cookieValue,
      domain:   new URL(BASE_URL).hostname,
      path:     '/',
      httpOnly: false,
      secure:   false,
      sameSite: 'Lax',
    },
  ])

  // ── Step 3: Navigate to dashboard and verify session works ─────────────────
  await page.goto(`${BASE_URL}/dashboard`)

  // The middleware should NOT redirect us back to login if the session is valid.
  // Wait for DOM content to be loaded before checking URL
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
  
  // We accept any URL that does NOT match /login.
  const currentUrl = page.url()
  if (currentUrl.includes('/login')) {
    // Retry navigation - sometimes SSR needs extra time
    await page.waitForTimeout(2000)
    await page.goto(`${BASE_URL}/dashboard`)
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
  }

  // Confirm we are on the dashboard or redirected somewhere inside the app
  const finalUrl = page.url()
  console.log(`✅ Auth setup: navigated to ${finalUrl}`)
  
  expect(finalUrl).not.toContain('/login')

  // ── Step 4: Save storageState for reuse ───────────────────────────────────
  await context.storageState({ path: AUTH_FILE })
})

