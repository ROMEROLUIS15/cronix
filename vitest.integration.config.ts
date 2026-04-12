/**
 * vitest.integration.config.ts — Config for Phase 4 integration tests.
 *
 * Uses Node.js environment (not jsdom) because integration tests make
 * real network calls to Supabase using the service role key.
 *
 * Run with: npx vitest run --config vitest.integration.config.ts
 */

import { defineConfig } from 'vitest/config'
import path from 'path'
import * as dotenv from 'dotenv'

// Load .env.local at config-evaluation time (process.cwd = project root when
// running `npm run test:integration` from the project directory).
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

export default defineConfig({
  test: {
    // ── Integration Tests (node — real network, real Supabase) ────────────────
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    // Integration tests can take up to 30s due to real DB calls
    testTimeout: 30_000,
    hookTimeout: 30_000,
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
