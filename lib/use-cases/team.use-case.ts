/**
 * Team Use Case — Pure business logic for team/employee management.
 *
 * NO framework dependencies.
 *
 * Exposes:
 *  - validateEmployeeForm:   validate employee form fields
 *  - getTeamStats:           compute team statistics from member list
 *  - filterNavByRole:        filter navigation items based on user role
 *  - formatMemberInitials:   extract initials for avatar display
 */

// ── Types ───────────────────────────────────────────────────────────────────

interface EmployeeFormInput {
  name: string
  email: string
  phone: string
}

interface ValidationResult {
  valid: boolean
  error: string | null
}

interface TeamMemberForStats {
  role: string | null
  is_active: boolean | null
}

interface NavItem {
  href: string
  label: string
  ownerOnly?: boolean
}

type UserRole = 'owner' | 'employee' | 'platform_admin' | null

// ── Validation ──────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validates employee form fields before submission.
 * Pure function — returns validation result with error message.
 */
export function validateEmployeeForm(input: EmployeeFormInput): ValidationResult {
  const name = input.name.trim()

  if (!name) {
    return { valid: false, error: 'El nombre es obligatorio.' }
  }

  if (name.length < 2) {
    return { valid: false, error: 'El nombre debe tener al menos 2 caracteres.' }
  }

  if (name.length > 100) {
    return { valid: false, error: 'El nombre no puede exceder 100 caracteres.' }
  }

  const email = input.email.trim()
  if (email && !EMAIL_REGEX.test(email)) {
    return { valid: false, error: 'El correo electrónico no es válido.' }
  }

  const phone = input.phone.trim()
  if (phone && phone.length < 7) {
    return { valid: false, error: 'El número de teléfono es muy corto.' }
  }

  return { valid: true, error: null }
}

// ── Statistics ──────────────────────────────────────────────────────────────

export interface TeamStats {
  total: number
  activeEmployees: number
  inactiveEmployees: number
  hasEmployees: boolean
}

/**
 * Computes team statistics from a list of team members.
 * Pure function — no side effects.
 */
export function getTeamStats(members: TeamMemberForStats[]): TeamStats {
  const employees = members.filter(m => m.role === 'employee')
  const activeEmployees = employees.filter(m => m.is_active === true)
  const inactiveEmployees = employees.filter(m => m.is_active === false || m.is_active === null)

  return {
    total: members.length,
    activeEmployees: activeEmployees.length,
    inactiveEmployees: inactiveEmployees.length,
    hasEmployees: employees.length > 0,
  }
}

// ── Navigation filtering ────────────────────────────────────────────────────

/**
 * Filters navigation items based on the current user's role.
 * Items marked `ownerOnly: true` are hidden from non-owner users.
 */
export function filterNavByRole<T extends NavItem>(items: T[], role: UserRole): T[] {
  return items.filter(item => !item.ownerOnly || role === 'owner')
}

// ── Display helpers ─────────────────────────────────────────────────────────

/**
 * Extracts up to 2 initials from a name for avatar display.
 * "Juan Pérez" → "JP", "Ana" → "AN", "" → "?"
 */
export function formatMemberInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return '?'

  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase()
  }

  const first = parts[0][0]
  const last = parts[parts.length - 1]?.[0]

  if (!first || !last) return '?'
  return (first + last).toUpperCase()
}
