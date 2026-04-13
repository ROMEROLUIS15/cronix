/**
 * Badge Component — Unit Tests (React Testing Library)
 *
 * Tests for components/ui/badge.tsx
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, AppointmentStatusBadge, DualBookingBadge } from '@/components/ui/badge'

describe('Badge Component', () => {
  it('renders children', () => {
    render(<Badge>Pending</Badge>)
    expect(screen.getByText(/pending/i)).toBeInTheDocument()
  })

  it('supports variant styles', () => {
    const { rerender } = render(<Badge variant="success">Active</Badge>)
    expect(screen.getByText(/active/i)).toBeInTheDocument()

    rerender(<Badge variant="danger">Cancelled</Badge>)
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument()
  })

  it('supports dot indicator', () => {
    render(<Badge dot>With dot</Badge>)
    expect(screen.getByText(/with dot/i)).toBeInTheDocument()
  })

  it('supports brand variant', () => {
    render(<Badge variant="brand">Brand</Badge>)
    expect(screen.getByText(/brand/i)).toBeInTheDocument()
  })

  it('supports dual variant', () => {
    render(<Badge variant="dual">Dual</Badge>)
    expect(screen.getByText(/dual/i)).toBeInTheDocument()
  })
})

describe('AppointmentStatusBadge', () => {
  it('renders pending status', () => {
    render(<AppointmentStatusBadge status="pending" />)
    expect(screen.getByText(/pendiente/i)).toBeInTheDocument()
  })

  it('renders confirmed status', () => {
    render(<AppointmentStatusBadge status="confirmed" />)
    expect(screen.getByText(/confirmada/i)).toBeInTheDocument()
  })

  it('renders cancelled status', () => {
    render(<AppointmentStatusBadge status="cancelled" />)
    expect(screen.getByText(/cancelada/i)).toBeInTheDocument()
  })

  it('renders completed status', () => {
    render(<AppointmentStatusBadge status="completed" />)
    expect(screen.getByText(/completada/i)).toBeInTheDocument()
  })

  it('renders no_show status', () => {
    render(<AppointmentStatusBadge status="no_show" />)
    expect(screen.getByText(/no asist/i)).toBeInTheDocument()
  })
})

describe('DualBookingBadge', () => {
  it('renders dual booking text', () => {
    render(<DualBookingBadge />)
    expect(screen.getByText(/doble cita/i)).toBeInTheDocument()
  })
})
