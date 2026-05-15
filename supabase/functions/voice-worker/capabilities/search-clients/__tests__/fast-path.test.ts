import { describe, it, expect } from 'vitest'
import { detectSearchClients } from '../fast-path.ts'

describe('search-clients fast path — positive cases', () => {
  it('"tienes a Luis Romero?" → captures full name', () => {
    expect(detectSearchClients('tienes a Luis Romero?')?.query).toBe('luis romero')
  })
  it('"busca a Ada Monsalve"', () => {
    expect(detectSearchClients('busca a Ada Monsalve')?.query).toBe('ada monsalve')
  })
  it('"búscame a María"', () => {
    expect(detectSearchClients('búscame a María')?.query).toBe('maría')
  })
  it('"existe el cliente Pedro Pérez"', () => {
    expect(detectSearchClients('existe el cliente Pedro Pérez')?.query).toBe('pedro pérez')
  })
  it('"hay alguien llamado Camila"', () => {
    expect(detectSearchClients('hay alguien llamado Camila')?.query).toBe('camila')
  })
  it('"cuál es el teléfono de Ana"', () => {
    expect(detectSearchClients('cuál es el teléfono de Ana')?.query).toBe('ana')
  })
  it('"teléfono de Sofía García"', () => {
    expect(detectSearchClients('teléfono de Sofía García')?.query).toBe('sofía garcía')
  })
  it('"pregunto por Luis Romero"', () => {
    expect(detectSearchClients('pregunto por Luis Romero')?.query).toBe('luis romero')
  })
  it('"qué sabes de Estefany"', () => {
    expect(detectSearchClients('qué sabes de Estefany')?.query).toBe('estefany')
  })
  it('"conoces a Gardi"', () => {
    expect(detectSearchClients('conoces a Gardi')?.query).toBe('gardi')
  })
  it('"tengo a Luis entre mis clientes" → strips connector', () => {
    expect(detectSearchClients('tengo a Luis entre mis clientes')?.query).toBe('luis')
  })
})

describe('search-clients fast path — write-verb rejections', () => {
  it('"agéndame a Luis" → null', () => {
    expect(detectSearchClients('agéndame a Luis')).toBeNull()
  })
  it('"cancela a Luis" → null', () => {
    expect(detectSearchClients('cancela la cita de Luis')).toBeNull()
  })
  it('"elimina a Luis" → null', () => {
    expect(detectSearchClients('elimina a Luis')).toBeNull()
  })
  it('"registra a Luis" → null', () => {
    expect(detectSearchClients('registra a Luis Romero')).toBeNull()
  })
  it('"reagenda la cita" → null', () => {
    expect(detectSearchClients('reagenda la cita de Luis')).toBeNull()
  })
})

describe('search-clients fast path — noise rejections', () => {
  it('"tengo mañana" → null (no real name captured)', () => {
    expect(detectSearchClients('tengo mañana')).toBeNull()
  })
  it('"tengo algo" → null', () => {
    expect(detectSearchClients('tengo algo')).toBeNull()
  })
  // Defensive guard — agenda phrases must never leak into name capture even
  // if list-appointments fails to match first (regression from the
  // "no tengo a 'para mañana' entre tus clientes" production answer).
  it('"qué clientes tengo para mañana" → null (preposition + date)', () => {
    expect(detectSearchClients('qué clientes tengo para mañana')).toBeNull()
  })
  it('"tengo para hoy" → null', () => {
    expect(detectSearchClients('tengo para hoy')).toBeNull()
  })
  it('"tengo el viernes" → null', () => {
    expect(detectSearchClients('tengo el viernes')).toBeNull()
  })
  it('plain greeting → null', () => {
    expect(detectSearchClients('hola luis')).toBeNull()
  })
  it('empty string → null', () => {
    expect(detectSearchClients('')).toBeNull()
  })
})
