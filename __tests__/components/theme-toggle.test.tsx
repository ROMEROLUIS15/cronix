/**
 * components/theme-toggle.tsx — Theme Toggle Component Tests
 *
 * Tests that:
 * - Three theme buttons render (light, system, dark)
 * - Clicking buttons calls setTheme with correct value
 * - Current theme is highlighted
 * - Icons render correctly for each theme
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from '@/components/theme-toggle'

// ── Mock next-themes ────────────────────────────────────────────────────────
const mockSetTheme = vi.fn()

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: mockSetTheme,
  }),
}))

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ThemeToggle Component', () => {
  it('renders three theme buttons', () => {
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: /tema light/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tema system/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tema dark/i })).toBeInTheDocument()
  })

  it('calls setTheme with correct theme when button is clicked', () => {
    render(<ThemeToggle />)

    const systemButton = screen.getByRole('button', { name: /tema system/i })
    fireEvent.click(systemButton)

    expect(mockSetTheme).toHaveBeenCalledWith('system')
  })

  it('highlights the current theme button', () => {
    vi.mocked(require('next-themes').useTheme).mockReturnValue({
      theme: 'dark',
      setTheme: mockSetTheme,
    })

    render(<ThemeToggle />)

    const darkButton = screen.getByRole('button', { name: /tema dark/i })
    expect(darkButton).toHaveClass('bg-brand-600')
  })

  it('renders correct icon for light theme', () => {
    render(<ThemeToggle />)

    const lightButton = screen.getByRole('button', { name: /tema light/i })
    expect(lightButton.querySelector('svg')).toBeInTheDocument()
  })

  it('all three buttons are clickable', () => {
    render(<ThemeToggle />)

    const lightButton = screen.getByRole('button', { name: /tema light/i })
    const systemButton = screen.getByRole('button', { name: /tema system/i })
    const darkButton = screen.getByRole('button', { name: /tema dark/i })

    fireEvent.click(lightButton)
    expect(mockSetTheme).toHaveBeenCalledWith('light')

    fireEvent.click(systemButton)
    expect(mockSetTheme).toHaveBeenCalledWith('system')

    fireEvent.click(darkButton)
    expect(mockSetTheme).toHaveBeenCalledWith('dark')

    expect(mockSetTheme).toHaveBeenCalledTimes(3)
  })

  it('has proper aria-label for accessibility', () => {
    render(<ThemeToggle />)

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveAttribute('aria-label')
    expect(buttons[1]).toHaveAttribute('aria-label')
    expect(buttons[2]).toHaveAttribute('aria-label')
  })
})
