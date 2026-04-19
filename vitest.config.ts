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
    // ── Coverage Reporting ────────────────────────────────────────────────────
    coverage: {
      provider: 'v8',
      include: [
        'lib/domain/**',
        'lib/repositories/**',
        'lib/ai/orchestrator/**',
        'app/api/**',
      ],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/node_modules/**',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
})

