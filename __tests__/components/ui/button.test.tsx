import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/components/ui/button'

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

describe('Button Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders a button element with children', () => {
      render(<Button>Click me</Button>)

      const button = screen.getByRole('button', { name: /click me/i })
      expect(button).toBeInTheDocument()
      expect(button).toBeInstanceOf(HTMLButtonElement)
    })

    it('passes HTML attributes to the button element', () => {
      render(
        <Button type="submit" name="test-button" data-testid="custom-button">
          Submit
        </Button>
      )

      const button = screen.getByTestId('custom-button')
      expect(button).toHaveAttribute('type', 'submit')
      expect(button).toHaveAttribute('name', 'test-button')
    })

    it('merges custom className with default classes', () => {
      render(<Button className="custom-class">Button</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('custom-class')
      expect(button).toHaveClass('inline-flex')
    })
  })

  describe('variants', () => {
    it('renders primary variant by default', () => {
      render(<Button>Primary</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-brand-600')
    })

    it('renders secondary variant', () => {
      render(<Button variant="secondary">Secondary</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-surface')
    })

    it('renders ghost variant', () => {
      render(<Button variant="ghost">Ghost</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-muted-foreground')
    })

    it('renders danger variant', () => {
      render(<Button variant="danger">Danger</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-danger')
    })
  })

  describe('sizes', () => {
    it('renders small size', () => {
      render(<Button size="sm">Small</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-xs')
    })

    it('renders medium size by default', () => {
      render(<Button>Medium</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-sm')
    })

    it('renders large size', () => {
      render(<Button size="lg">Large</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-base')
    })
  })

  describe('disabled state', () => {
    it('disables button when disabled prop is set', () => {
      render(<Button disabled>Disabled</Button>)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('disables button when loading', () => {
      render(<Button loading>Loading</Button>)

      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  describe('loading state', () => {
    it('shows a loading spinner instead of content', () => {
      render(<Button loading>Loading</Button>)

      const button = screen.getByRole('button')
      const spinner = button.querySelector('span.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('hides left and right icons when loading', () => {
      render(
        <Button loading leftIcon={<span data-testid="icon">L</span>}>
          Loading
        </Button>
      )

      expect(screen.queryByTestId('icon')).not.toBeInTheDocument()
    })
  })

  describe('icons', () => {
    it('renders left and right icons', () => {
      render(
        <Button
          leftIcon={<span data-testid="left">L</span>}
          rightIcon={<span data-testid="right">R</span>}
        >
          Text
        </Button>
      )

      expect(screen.getByTestId('left')).toBeInTheDocument()
      expect(screen.getByTestId('right')).toBeInTheDocument()
    })
  })

  describe('interaction', () => {
    it('calls onClick handler when clicked', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Click</Button>)

      fireEvent.click(screen.getByRole('button'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('does not call onClick when disabled', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick} disabled>Click</Button>)

      fireEvent.click(screen.getByRole('button'))
      expect(handleClick).not.toHaveBeenCalled()
    })
  })
})
