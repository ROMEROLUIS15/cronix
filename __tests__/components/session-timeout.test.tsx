/**
 * components/session-timeout.tsx — Session Timeout Component Tests
 *
 * Tests that:
 * - Dialog is not shown when no warning
 * - Inactivity warning dialog shows with Keep Session button
 * - Absolute timeout warning shows with only Sign Out button
 * - Countdown timer formats correctly (minutes and seconds)
 * - Button callbacks work correctly
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionTimeout } from '@/components/session-timeout'

// ── Mock useSessionTimeout ──────────────────────────────────────────────────
const mockOnKeepSession = vi.fn()
const mockOnSignout = vi.fn()

vi.mock('@/components/hooks/use-session-timeout', () => ({
  useSessionTimeout: vi.fn(() => ({
    warning: null,
    warningMsLeft: 0,
    onKeepSession: mockOnKeepSession,
    onSignout: mockOnSignout,
  })),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      stillThereTitle: 'Still there?',
      stillThereDesc: 'Your session is about to expire',
      expiringTitle: 'Session expiring',
      expiringDesc: 'Your session is about to expire',
    }
    return translations[key] || key
  },
}))

import { useSessionTimeout } from '@/components/hooks/use-session-timeout'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SessionTimeout Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no warning is active', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: null,
      warningMsLeft: 0,
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    const { container } = render(<SessionTimeout />)
    expect(container.firstChild).toBeNull()
  })

  it('shows inactivity warning with Keep Session button', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'inactivity',
      warningMsLeft: 60000, // 1 minute
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    render(<SessionTimeout />)

    expect(screen.getByText('Still there?')).toBeInTheDocument()
    expect(screen.getByText('Your session is about to expire')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mantener sesión/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cerrar sesión/i })).toBeInTheDocument()
  })

  it('shows absolute timeout warning with only Sign Out button', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'absolute',
      warningMsLeft: 30000, // 30 seconds
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    render(<SessionTimeout />)

    expect(screen.getByText('Session expiring')).toBeInTheDocument()
    expect(screen.getByText('Your session is about to expire')).toBeInTheDocument()

    // Should have only one button (Sign Out)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent(/Cerrar sesión/i)
  })

  it('formats countdown in minutes and seconds', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'inactivity',
      warningMsLeft: 125000, // 2:05 (2 minutes 5 seconds)
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    render(<SessionTimeout />)

    expect(screen.getByText('2:05 min')).toBeInTheDocument()
  })

  it('formats countdown in seconds only when less than a minute', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'inactivity',
      warningMsLeft: 45000, // 45 seconds
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    render(<SessionTimeout />)

    expect(screen.getByText('45 seg')).toBeInTheDocument()
  })

  it('shows 0 seconds when countdown reaches zero', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'inactivity',
      warningMsLeft: 100, // ~0 seconds
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    render(<SessionTimeout />)

    expect(screen.getByText('0 seg')).toBeInTheDocument()
  })

  it('calls onKeepSession when Keep Session button is clicked', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'inactivity',
      warningMsLeft: 60000,
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    render(<SessionTimeout />)

    const keepButton = screen.getByRole('button', { name: /Mantener sesión/i })
    fireEvent.click(keepButton)

    expect(mockOnKeepSession).toHaveBeenCalledTimes(1)
  })

  it('calls onSignout when Sign Out button is clicked', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'inactivity',
      warningMsLeft: 60000,
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    render(<SessionTimeout />)

    const signoutButton = screen.getByRole('button', { name: /Cerrar sesión/i })
    fireEvent.click(signoutButton)

    expect(mockOnSignout).toHaveBeenCalledTimes(1)
  })

  it('renders dialog with proper styling and positioning', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'inactivity',
      warningMsLeft: 60000,
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    const { container } = render(<SessionTimeout />)

    const dialog = container.querySelector('[style*="fixed"]')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveStyle({ zIndex: '9999' })
  })

  it('pads seconds with zero in countdown display', () => {
    vi.mocked(useSessionTimeout).mockReturnValue({
      warning: 'inactivity',
      warningMsLeft: 65000, // 1:05
      onKeepSession: mockOnKeepSession,
      onSignout: mockOnSignout,
    })

    render(<SessionTimeout />)

    expect(screen.getByText('1:05 min')).toBeInTheDocument()
  })
})
