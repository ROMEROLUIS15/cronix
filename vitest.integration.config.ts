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

// Load .env.local if dotenv is available; otherwise env vars must be set externally
let dotenv: any
try { dotenv = require('dotenv') } catch { /* dotenv not installed — skip */ }
if (dotenv) dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

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
