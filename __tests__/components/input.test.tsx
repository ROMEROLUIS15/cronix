/**
 * Input Component — Unit Tests (React Testing Library)
 *
 * Tests for components/ui/input.tsx
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Input } from '@/components/ui/input'

describe('Input Component', () => {
  it('renders with label', () => {
    render(<Input id="email" label="Email" />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })

  it('handles value changes', () => {
    const onChange = vi.fn()
    render(<Input id="name" label="Name" onChange={onChange} />)

    const input = screen.getByLabelText(/name/i)
    fireEvent.change(input, { target: { value: 'John' } })

    expect(onChange).toHaveBeenCalled()
  })

  it('displays error message', () => {
    render(<Input id="email" label="Email" error="Invalid email" />)
    expect(screen.getByText(/invalid email/i)).toBeInTheDocument()
  })

  it('supports different input types', () => {
    render(<Input id="password" label="Password" type="password" />)
    const input = screen.getByLabelText(/password/i)
    expect(input).toHaveAttribute('type', 'password')
  })

  it('supports disabled state', () => {
    render(<Input id="name" label="Name" disabled />)
    expect(screen.getByLabelText(/name/i)).toBeDisabled()
  })

  it('supports placeholder text', () => {
    render(<Input id="search" label="Search" placeholder="Type here..." />)
    expect(screen.getByPlaceholderText(/type here/i)).toBeInTheDocument()
  })
})
