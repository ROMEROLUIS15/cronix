import { defineConfig, devices } from '@playwright/test'
import path from 'path'
import * as dotenv from 'dotenv'

// Load .env.local so E2E_TEST_EMAIL, E2E_TEST_PASSWORD and SUPABASE_* vars
// are available in all test files — Playwright doesn't load this automatically.
dotenv.config({ path: path.resolve(__dirname, '.env.local') })

/**
 * Playwright config — E2E + Visual tests.
 * Auth is handled via a one-time setup project (auth.setup.ts).
 * See https://playwright.dev/docs/test-configuration.
 *
 * OPTIMIZATION: Run against production build (npm run build + start)
 * instead of dev server to catch production-only bugs.
 * Multi-browser support: Chromium, Firefox, WebKit (Safari engine).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace:      'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // ── 1. Auth setup — runs once, saves storage state ──────────────────────
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // ── 2. Chromium (primary) — depend on saved auth state ─────────────────
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'playwright/.auth/user.json'),
      },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },

    // ── 3. Firefox — catch Firefox-specific rendering/behavior issues ──────
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: path.join(__dirname, 'playwright/.auth/user.json'),
      },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/],
    },

    // ── 4. WebKit (Safari engine) — catch Safari compatibility issues ──────
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        storageState: path.join(__dirname, 'playwright/.auth/user.json'),
      },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/],
    },

    // ── 5. Mobile Chrome — test responsive layout ──────────────────────────
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 7'],
        storageState: path.join(__dirname, 'playwright/.auth/user.json'),
      },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/],
    },

    // ── 6. Unauthenticated smoke tests — no auth dependency ──────────────────
    {
      name: 'smoke',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /smoke\.spec\.ts/,
    },
  ],

  webServer: {
    // Build for production first, then start the prod server
    command: 'npm run build && npm run start',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000, // 3 min to account for build time
    stdout: 'pipe',
    stderr: 'pipe',
  },
})

