import { describe, it, expect } from 'vitest'
import { detectGetServices } from '../fast-path.ts'

describe('get-services fast path — positive cases', () => {
  it('"qué servicios tienes disponibles" → matches', () => {
    expect(detectGetServices('qué servicios tienes disponibles')).toEqual({})
  })
  it('"hay servicios disponibles?" → matches', () => {
    expect(detectGetServices('hay servicios disponibles?')).toEqual({})
  })
  it('"cuáles son los servicios" → matches', () => {
    expect(detectGetServices('cuáles son los servicios')).toEqual({})
  })
  it('"qué servicios ofreces" → matches', () => {
    expect(detectGetServices('qué servicios ofreces')).toEqual({})
  })
  it('"lista de servicios" → matches', () => {
    expect(detectGetServices('lístame los servicios')).toEqual({})
  })
  it('"muéstrame tus servicios" → matches', () => {
    expect(detectGetServices('muéstrame tus servicios')).toEqual({})
  })
  it('"dime los servicios del negocio" → matches', () => {
    expect(detectGetServices('dime los servicios del negocio')).toEqual({})
  })
  it('"tienes servicios disponibles" → matches', () => {
    expect(detectGetServices('tienes servicios disponibles')).toEqual({})
  })
  it('"qué tratamientos tienes" → matches (synonym)', () => {
    expect(detectGetServices('qué tratamientos tienes')).toEqual({})
  })
  it('"qué tratamientos manejan" → matches', () => {
    expect(detectGetServices('qué tratamientos manejan')).toEqual({})
  })
  it('"qué ofreces" → matches (noun elided)', () => {
    expect(detectGetServices('qué ofreces')).toEqual({})
  })
  it('"muéstrame el menú" → matches', () => {
    expect(detectGetServices('muéstrame el menú')).toEqual({})
  })
  it('"enséñame los servicios" → matches', () => {
    expect(detectGetServices('enséñame los servicios')).toEqual({})
  })
})

describe('get-services fast path — rejections', () => {
  it('"agéndale el servicio de manicure a Ana mañana" → null (write intent)', () => {
    expect(detectGetServices('agéndale el servicio de manicure a Ana mañana')).toBeNull()
  })
  it('"busca a Servando" → null (client name, no servicio token)', () => {
    expect(detectGetServices('busca a Servando')).toBeNull()
  })
  it('"qué citas tengo mañana" → null', () => {
    expect(detectGetServices('qué citas tengo mañana')).toBeNull()
  })
  it('"cuánto cuesta la manicure" → null (price question goes to LLM)', () => {
    expect(detectGetServices('cuánto cuesta la manicure')).toBeNull()
  })
  it('"qué haces" → null (not a catalog ask)', () => {
    expect(detectGetServices('qué haces')).toBeNull()
  })
  it('"qué precio tiene el corte" → null', () => {
    expect(detectGetServices('qué precio tiene el corte')).toBeNull()
  })
  it('empty string → null', () => {
    expect(detectGetServices('')).toBeNull()
  })
})
