/**
 * components/ui/password-input.tsx — Password Input Component Tests
 *
 * Tests visibility toggle and input behavior
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PasswordInput } from '@/components/ui/password-input'

vi.mock('lucide-react', () => ({
  Eye: () => <div data-testid="eye-icon" />,
  EyeOff: () => <div data-testid="eye-off-icon" />,
}))

describe('PasswordInput Component', () => {
  it('renders with password type initially', () => {
    const { container } = render(<PasswordInput />)
    // A type="password" input has no "textbox" ARIA role, so query the element.
    const input = container.querySelector('input')!
    expect(input).toHaveAttribute('type', 'password')
  })

  it('toggles password visibility on button click', () => {
    const { container } = render(<PasswordInput />)
    const input = container.querySelector('input')!
    const toggleButton = screen.getByRole('button')

    expect(input).toHaveAttribute('type', 'password')

    fireEvent.click(toggleButton)
    expect(input).toHaveAttribute('type', 'text')

    fireEvent.click(toggleButton)
    expect(input).toHaveAttribute('type', 'password')
  })

  it('shows EyeOff icon initially', () => {
    render(<PasswordInput />)
    expect(screen.getByTestId('eye-off-icon')).toBeInTheDocument()
  })

  it('shows Eye icon when password is visible', () => {
    render(<PasswordInput />)
    const toggleButton = screen.getByRole('button')

    fireEvent.click(toggleButton)
    expect(screen.getByTestId('eye-icon')).toBeInTheDocument()
  })

  it('supports aria-label for accessibility', () => {
    render(<PasswordInput />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-label')
  })

  it('accepts standard input props', () => {
    const { container } = render(<PasswordInput placeholder="Enter password" name="password" required />)
    const input = container.querySelector('input')!

    expect(input).toHaveAttribute('placeholder', 'Enter password')
    expect(input).toHaveAttribute('name', 'password')
    expect(input).toHaveAttribute('required')
  })

  it('can receive and display typed value', () => {
    const { container } = render(<PasswordInput />)
    const input = container.querySelector('input') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'testpassword123' } })
    expect(input.value).toBe('testpassword123')
  })

  it('toggle button has tabIndex -1 (not in tab order)', () => {
    render(<PasswordInput />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('tabIndex', '-1')
  })

  it('applies custom className', () => {
    const { container } = render(<PasswordInput className="custom-class" />)
    const input = container.querySelector('input')
    expect(input?.className).toContain('custom-class')
  })

  it('button is type="button" (not submit)', () => {
    render(<PasswordInput />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('type', 'button')
  })
})
