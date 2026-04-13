import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    // ── Unit & Repository Tests (jsdom — component-compatible) ───────────────
    environment: 'jsdom',
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/tests/e2e/**',           // Playwright tests — run with `npx playwright test`
      '**/*.spec.ts',              // Playwright spec files use .spec.ts convention
      '**/tests/integration/**',   // Integration tests — run separately
      '__tests__/components/**',   // Component tests — run with vitest.components.config.ts
    ],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})

