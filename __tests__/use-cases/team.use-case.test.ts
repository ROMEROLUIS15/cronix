import { describe, it, expect } from 'vitest'
import {
  validateEmployeeForm,
  getTeamStats,
  filterNavByRole,
  formatMemberInitials,
} from '@/lib/use-cases/team.use-case'

// ── validateEmployeeForm ────────────────────────────────────────────────────

describe('validateEmployeeForm', () => {
  it('debe rechazar nombre vacío', () => {
    const result = validateEmployeeForm({ name: '', email: '', phone: '' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('obligatorio')
  })

  it('debe rechazar nombre con solo espacios', () => {
    const result = validateEmployeeForm({ name: '   ', email: '', phone: '' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('obligatorio')
  })

  it('debe rechazar nombre de 1 carácter', () => {
    const result = validateEmployeeForm({ name: 'A', email: '', phone: '' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('al menos 2')
  })

  it('debe rechazar nombre mayor a 100 caracteres', () => {
    const result = validateEmployeeForm({ name: 'A'.repeat(101), email: '', phone: '' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('100')
  })

  it('debe aceptar nombre válido sin email ni teléfono', () => {
    const result = validateEmployeeForm({ name: 'Carlos López', email: '', phone: '' })
    expect(result.valid).toBe(true)
    expect(result.error).toBeNull()
  })

  it('debe rechazar email inválido', () => {
    const result = validateEmployeeForm({ name: 'Carlos', email: 'no-es-email', phone: '' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('correo')
  })

  it('debe aceptar email válido', () => {
    const result = validateEmployeeForm({ name: 'Carlos', email: 'carlos@test.com', phone: '' })
    expect(result.valid).toBe(true)
  })

  it('debe rechazar teléfono muy corto', () => {
    const result = validateEmployeeForm({ name: 'Carlos', email: '', phone: '123' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('corto')
  })

  it('debe aceptar teléfono válido', () => {
    const result = validateEmployeeForm({ name: 'Carlos', email: '', phone: '+57 300 1234567' })
    expect(result.valid).toBe(true)
  })

  it('debe aceptar formulario completo válido', () => {
    const result = validateEmployeeForm({
      name: 'María García',
      email: 'maria@salon.com',
      phone: '+57 321 9876543',
    })
    expect(result.valid).toBe(true)
    expect(result.error).toBeNull()
  })
})

// ── getTeamStats ────────────────────────────────────────────────────────────

describe('getTeamStats', () => {
  it('debe retornar stats vacíos cuando no hay miembros', () => {
    const stats = getTeamStats([])
    expect(stats.total).toBe(0)
    expect(stats.activeEmployees).toBe(0)
    expect(stats.inactiveEmployees).toBe(0)
    expect(stats.hasEmployees).toBe(false)
  })

  it('debe contar solo al owner cuando no hay empleados', () => {
    const stats = getTeamStats([{ role: 'owner', is_active: true }])
    expect(stats.total).toBe(1)
    expect(stats.activeEmployees).toBe(0)
    expect(stats.hasEmployees).toBe(false)
  })

  it('debe contar empleados activos e inactivos por separado', () => {
    const stats = getTeamStats([
      { role: 'owner', is_active: true },
      { role: 'employee', is_active: true },
      { role: 'employee', is_active: true },
      { role: 'employee', is_active: false },
    ])
    expect(stats.total).toBe(4)
    expect(stats.activeEmployees).toBe(2)
    expect(stats.inactiveEmployees).toBe(1)
    expect(stats.hasEmployees).toBe(true)
  })

  it('debe tratar is_active null como inactivo', () => {
    const stats = getTeamStats([
      { role: 'employee', is_active: null },
    ])
    expect(stats.inactiveEmployees).toBe(1)
    expect(stats.activeEmployees).toBe(0)
  })
})

// ── filterNavByRole ─────────────────────────────────────────────────────────

describe('filterNavByRole', () => {
  const navItems = [
    { href: '/dashboard', label: 'Agenda' },
    { href: '/dashboard/clients', label: 'Clientes' },
    { href: '/dashboard/team', label: 'Equipo', ownerOnly: true },
    { href: '/dashboard/settings', label: 'Ajustes' },
  ]

  it('debe mostrar todos los items al owner', () => {
    const result = filterNavByRole(navItems, 'owner')
    expect(result).toHaveLength(4)
    expect(result.map(i => i.label)).toContain('Equipo')
  })

  it('debe ocultar items ownerOnly a empleados', () => {
    const result = filterNavByRole(navItems, 'employee')
    expect(result).toHaveLength(3)
    expect(result.map(i => i.label)).not.toContain('Equipo')
  })

  it('debe ocultar items ownerOnly cuando role es null', () => {
    const result = filterNavByRole(navItems, null)
    expect(result).toHaveLength(3)
    expect(result.map(i => i.label)).not.toContain('Equipo')
  })

  it('debe ocultar items ownerOnly a platform_admin', () => {
    const result = filterNavByRole(navItems, 'platform_admin')
    expect(result).toHaveLength(3)
  })

  it('debe retornar todos cuando ningún item es ownerOnly', () => {
    const publicItems = [
      { href: '/a', label: 'A' },
      { href: '/b', label: 'B' },
    ]
    expect(filterNavByRole(publicItems, 'employee')).toHaveLength(2)
    expect(filterNavByRole(publicItems, 'owner')).toHaveLength(2)
  })
})

// ── formatMemberInitials ────────────────────────────────────────────────────

describe('formatMemberInitials', () => {
  it('debe extraer 2 iniciales de nombre y apellido', () => {
    expect(formatMemberInitials('Juan Pérez')).toBe('JP')
  })

  it('debe usar primeras 2 letras cuando hay un solo nombre', () => {
    expect(formatMemberInitials('Ana')).toBe('AN')
  })

  it('debe tomar primera y última palabra con nombres compuestos', () => {
    expect(formatMemberInitials('María José García')).toBe('MG')
  })

  it('debe retornar ? para string vacío', () => {
    expect(formatMemberInitials('')).toBe('?')
  })

  it('debe retornar ? para string con solo espacios', () => {
    expect(formatMemberInitials('   ')).toBe('?')
  })

  it('debe retornar iniciales en mayúsculas', () => {
    expect(formatMemberInitials('carlos lópez')).toBe('CL')
  })
})
