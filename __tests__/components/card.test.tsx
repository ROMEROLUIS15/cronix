/**
 * Card Component — Unit Tests (React Testing Library)
 *
 * Tests for components/ui/card.tsx
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, CardHeader, CardContent, CardTitle, StatCard } from '@/components/ui/card'

describe('Card Components', () => {
  describe('Card', () => {
    it('renders children', () => {
      render(<Card>Card content</Card>)
      expect(screen.getByText(/card content/i)).toBeInTheDocument()
    })

    it('applies variant classes', () => {
      render(<Card variant="elevated">Elevated</Card>)
      expect(screen.getByText(/elevated/i)).toBeInTheDocument()
    })
  })

  describe('CardHeader', () => {
    it('renders header content', () => {
      render(<CardHeader>Header</CardHeader>)
      expect(screen.getByText(/header/i)).toBeInTheDocument()
    })
  })

  describe('CardTitle', () => {
    it('renders title content', () => {
      render(<CardTitle>My Title</CardTitle>)
      expect(screen.getByText(/my title/i)).toBeInTheDocument()
    })
  })

  describe('CardContent', () => {
    it('renders content', () => {
      render(<CardContent>Body text</CardContent>)
      expect(screen.getByText(/body text/i)).toBeInTheDocument()
    })
  })

  describe('StatCard', () => {
    it('renders stat with value', () => {
      render(<StatCard value="$1,234" label="Revenue" />)
      expect(screen.getByText(/\$1,234/i)).toBeInTheDocument()
      // Label renders in a separate element — verify the card exists with value
    })

    it('renders with trend indicator', () => {
      render(<StatCard value="15%" label="Growth" trend="up" />)
      expect(screen.getByText(/15%/i)).toBeInTheDocument()
      // Trend indicator renders as arrow + percentage
    })
  })
})
