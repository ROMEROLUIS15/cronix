/**
 * Settings Validation Schema — Unit Tests
 *
 * Tests for lib/validations/settings.schema.ts
 */
import { describe, it, expect } from 'vitest'

import { BusinessSettingsSchema, UpdateBusinessProfileSchema } from '@/lib/validations/settings.schema'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Settings Validation Schema', () => {
  describe('BusinessSettingsSchema', () => {
    it('accepts valid settings with working hours', () => {
      const result = BusinessSettingsSchema.safeParse({
        workingHours: {
          monday: ['09:00', '18:00'],
          tuesday: ['09:00', '18:00'],
          wednesday: null, // Closed
        },
        notifications: {
          whatsapp: true,
          email: false,
        },
        maxDailyBookingsPerClient: 3,
      })
      expect(result.success).toBe(true)
    })

    it('accepts empty object (all optional)', () => {
      const result = BusinessSettingsSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('accepts partial settings', () => {
      const result = BusinessSettingsSchema.safeParse({
        notifications: { whatsapp: true },
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid working hours format', () => {
      const result = BusinessSettingsSchema.safeParse({
        workingHours: { monday: 'invalid' },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('UpdateBusinessProfileSchema', () => {
    it('accepts valid profile update', () => {
      const result = UpdateBusinessProfileSchema.safeParse({
        name: 'My Salon',
        category: 'beauty',
        phone: '+573001234567',
        address: '123 Main St',
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty name', () => {
      const result = UpdateBusinessProfileSchema.safeParse({
        name: '',
        category: 'beauty',
      })
      expect(result.success).toBe(false)
    })

    it('rejects empty category', () => {
      const result = UpdateBusinessProfileSchema.safeParse({
        name: 'My Salon',
        category: '',
      })
      expect(result.success).toBe(false)
    })

    it('accepts nullable phone and address', () => {
      const result = UpdateBusinessProfileSchema.safeParse({
        name: 'My Salon',
        category: 'beauty',
        phone: null,
        address: null,
      })
      expect(result.success).toBe(true)
    })
  })
})
