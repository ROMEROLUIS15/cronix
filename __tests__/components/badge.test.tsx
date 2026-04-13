/**
 * Badge Component — Unit Tests (React Testing Library)
 *
 * Tests for components/ui/badge.tsx
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, StatusBadge } from '@/components/ui/badge'

describe('Badge Component', () => {
  it('renders children', () => {
    render(<Badge>Pending</Badge>)
    expect(screen.getByText(/pending/i)).toBeInTheDocument()
  })

  it('supports variant styles', () => {
    const { rerender } = render(<Badge variant="success">Active</Badge>)
    expect(screen.getByText(/active/i)).toBeInTheDocument()

    rerender(<Badge variant="destructive">Cancelled</Badge>)
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument()
  })
})

describe('StatusBadge', () => {
  it('renders status text', () => {
    render(<StatusBadge status="confirmed" />)
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument()
  })

  it('renders different statuses', () => {
    const { rerender } = render(<StatusBadge status="pending" />)
    expect(screen.getByText(/pending/i)).toBeInTheDocument()

    rerender(<StatusBadge status="cancelled" />)
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument()
  })
})
