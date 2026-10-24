import { describe, it, expect } from 'vitest'
import { CreateServiceSchema, UpdateServiceSchema } from '@/lib/validations/service.schema'

describe('CreateServiceSchema', () => {
  const validInput = {
    business_id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Corte de cabello',
    duration_min: 30,
    price: 25000,
  }

  it('debe aceptar input válido', () => {
    const result = CreateServiceSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('debe rechazar sin nombre', () => {
    const { name: _, ...rest } = validInput
    const result = CreateServiceSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('debe rechazar precio negativo', () => {
    const result = CreateServiceSchema.safeParse({ ...validInput, price: -5 })
    expect(result.success).toBe(false)
  })

  it('debe rechazar duración no positiva', () => {
    const result = CreateServiceSchema.safeParse({ ...validInput, duration_min: 0 })
    expect(result.success).toBe(false)
  })

  it('debe aceptar color hexadecimal válido', () => {
    const result = CreateServiceSchema.safeParse({ ...validInput, color: '#FF5733' })
    expect(result.success).toBe(true)
  })

  it('debe rechazar color con formato inválido', () => {
    const result = CreateServiceSchema.safeParse({ ...validInput, color: 'rojo' })
    expect(result.success).toBe(false)
  })

  it('debe aceptar precio 0 (servicio gratis)', () => {
    const result = CreateServiceSchema.safeParse({ ...validInput, price: 0 })
    expect(result.success).toBe(true)
  })
})

describe('UpdateServiceSchema', () => {
  it('debe aceptar actualización parcial solo con precio', () => {
    const result = UpdateServiceSchema.safeParse({ price: 30000 })
    expect(result.success).toBe(true)
  })

  it('no debe reactivar el servicio: el default is_active de creación no aplica al update', () => {
    const result = UpdateServiceSchema.safeParse({ price: 30000 })
    expect(result.success && result.data).toEqual({ price: 30000 })
  })

  it('debe rechazar precio negativo en update parcial', () => {
    const result = UpdateServiceSchema.safeParse({ price: -10 })
    expect(result.success).toBe(false)
  })
})
