/**
 * Vitest setup for component tests — jsdom environment
 */
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['__tests__/components/**/*.test.tsx'],
    setupFiles: ['__tests__/setup/test-setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
