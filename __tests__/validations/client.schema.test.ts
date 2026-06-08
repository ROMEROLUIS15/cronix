import { describe, it, expect } from 'vitest'
import { CreateClientSchema, UpdateClientSchema } from '@/lib/validations/client.schema'

describe('CreateClientSchema', () => {
  const validInput = {
    business_id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Maria Garcia',
    phone: '+573001234567',
  }

  it('accepts valid input', () => {
    const result = CreateClientSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('rejects name shorter than 2 characters', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, name: 'M' })
    expect(result.success).toBe(false)
  })

  it('rejects name exceeding 100 characters', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, name: 'x'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('rejects invalid phone format', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, phone: 'abc' })
    expect(result.success).toBe(false)
  })

  it('accepts valid optional email', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, email: 'maria@test.com' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email format', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('accepts empty email string', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, email: '' })
    expect(result.success).toBe(true)
  })

  it('accepts null email', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, email: null })
    expect(result.success).toBe(true)
  })

  it('rejects more than 10 tags', () => {
    const result = CreateClientSchema.safeParse({
      ...validInput,
      tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
    })
    expect(result.success).toBe(false)
  })

  it('rejects tag exceeding 30 characters', () => {
    const result = CreateClientSchema.safeParse({
      ...validInput,
      tags: ['x'.repeat(31)],
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty phone string', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, phone: '' })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID business_id', () => {
    const result = CreateClientSchema.safeParse({ ...validInput, business_id: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('defaults tags to empty array when omitted', () => {
    const result = CreateClientSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tags).toEqual([])
    }
  })
})

describe('UpdateClientSchema', () => {
  it('accepts partial update with just name', () => {
    const result = UpdateClientSchema.safeParse({ name: 'New Name' })
    expect(result.success).toBe(true)
  })

  it('accepts empty body (all fields optional)', () => {
    const result = UpdateClientSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects short name in partial update', () => {
    const result = UpdateClientSchema.safeParse({ name: 'X' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid phone in partial update', () => {
    const result = UpdateClientSchema.safeParse({ phone: 'bad' })
    expect(result.success).toBe(false)
  })
})
