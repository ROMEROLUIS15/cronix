/**
 * Auth Validation Schema — Unit Tests
 *
 * Tests for lib/validations/auth.ts (static schemas)
 */
import { describe, it, expect } from 'vitest'

import { loginSchema, registerSchema, resetPasswordSchema } from '@/lib/validations/auth'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Auth Validation Schemas', () => {
  describe('loginSchema', () => {
    it('accepts valid email and password', () => {
      const result = loginSchema.safeParse({ email: 'test@example.com', password: 'password123' })
      expect(result.success).toBe(true)
    })

    it('rejects invalid email format', () => {
      const result = loginSchema.safeParse({ email: 'not-an-email', password: 'password123' })
      expect(result.success).toBe(false)
    })

    it('rejects empty email', () => {
      const result = loginSchema.safeParse({ email: '', password: 'password123' })
      expect(result.success).toBe(false)
    })

    it('rejects empty password', () => {
      const result = loginSchema.safeParse({ email: 'test@example.com', password: '' })
      expect(result.success).toBe(false)
    })

    it('rejects missing fields', () => {
      const result = loginSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe('registerSchema', () => {
    const validData = {
      firstName: 'John',
      lastName: 'Doe',
      bizName: 'My Business',
      bizCategory: 'Estética / Belleza',
      email: 'john@example.com',
      password: 'SecureP@ss1',
      confirmPassword: 'SecureP@ss1',
    }

    it('accepts valid registration data', () => {
      const result = registerSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('rejects short first name', () => {
      const result = registerSchema.safeParse({ ...validData, firstName: 'J' })
      expect(result.success).toBe(false)
    })

    it('rejects short last name', () => {
      const result = registerSchema.safeParse({ ...validData, lastName: 'D' })
      expect(result.success).toBe(false)
    })

    it('rejects short business name', () => {
      const result = registerSchema.safeParse({ ...validData, bizName: 'X' })
      expect(result.success).toBe(false)
    })

    it('rejects mismatched passwords', () => {
      const result = registerSchema.safeParse({ ...validData, confirmPassword: 'Different1!' })
      expect(result.success).toBe(false)
    })

    it('rejects weak password', () => {
      const result = registerSchema.safeParse({ ...validData, password: 'weak', confirmPassword: 'weak' })
      expect(result.success).toBe(false)
    })

    it('rejects invalid business category', () => {
      const result = registerSchema.safeParse({ ...validData, bizCategory: 'nonexistent' })
      expect(result.success).toBe(false)
    })
  })

  describe('resetPasswordSchema', () => {
    it('accepts matching strong passwords', () => {
      const result = resetPasswordSchema.safeParse({
        password: 'NewSecure1!',
        confirmPassword: 'NewSecure1!',
      })
      expect(result.success).toBe(true)
    })

    it('rejects mismatched passwords', () => {
      const result = resetPasswordSchema.safeParse({
        password: 'Password1!',
        confirmPassword: 'Password2!',
      })
      expect(result.success).toBe(false)
    })

    it('rejects weak password', () => {
      const result = resetPasswordSchema.safeParse({
        password: 'weak',
        confirmPassword: 'weak',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing fields', () => {
      const result = resetPasswordSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})
