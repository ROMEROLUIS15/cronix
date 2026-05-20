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

  it('renders button with text content', () => {
    render(<Button>Click me</Button>)

    expect(screen.getByRole('button', { name: /Click me/i })).toBeInTheDocument()
  })

  it('renders primary variant by default', () => {
    const { container } = render(<Button>Primary</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('bg-brand-600')
  })

  it('renders secondary variant', () => {
    const { container } = render(<Button variant="secondary">Secondary</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('bg-surface')
  })

  it('renders ghost variant', () => {
    const { container } = render(<Button variant="ghost">Ghost</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('text-muted-foreground')
  })

  it('renders danger variant', () => {
    const { container } = render(<Button variant="danger">Danger</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('bg-danger')
  })

  it('renders small size', () => {
    const { container } = render(<Button size="sm">Small</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('px-3')
    expect(button).toHaveClass('py-1.5')
    expect(button).toHaveClass('text-xs')
  })

  it('renders medium size by default', () => {
    const { container } = render(<Button>Medium</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('px-5')
    expect(button).toHaveClass('py-2.5')
    expect(button).toHaveClass('text-sm')
  })

  it('renders large size', () => {
    const { container } = render(<Button size="lg">Large</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('px-6')
    expect(button).toHaveClass('py-3')
    expect(button).toHaveClass('text-base')
  })

  it('disables button when disabled prop true', () => {
    render(<Button disabled>Disabled</Button>)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('disables button when loading', () => {
    render(<Button loading>Loading</Button>)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('shows loading spinner when loading', () => {
    const { container } = render(<Button loading>Loading</Button>)

    const spinner = container.querySelector('span[class*="animate-spin"]')
    expect(spinner).toBeInTheDocument()
  })

  it('hides left icon when loading', () => {
    const { container } = render(
      <Button loading leftIcon={<span>Icon</span>}>
        Loading
      </Button>
    )

    const spinner = container.querySelector('span[class*="animate-spin"]')
    expect(spinner).toBeInTheDocument()
    expect(screen.queryByText('Icon')).not.toBeInTheDocument()
  })

  it('hides right icon when loading', () => {
    const { container } = render(
      <Button loading rightIcon={<span>Icon</span>}>
        Loading
      </Button>
    )

    const spinner = container.querySelector('span[class*="animate-spin"]')
    expect(spinner).toBeInTheDocument()
    expect(screen.queryByText('Icon')).not.toBeInTheDocument()
  })

  it('renders left icon', () => {
    render(<Button leftIcon={<span data-testid="left">L</span>}>Text</Button>)

    expect(screen.getByTestId('left')).toBeInTheDocument()
  })

  it('renders right icon', () => {
    render(<Button rightIcon={<span data-testid="right">R</span>}>Text</Button>)

    expect(screen.getByTestId('right')).toBeInTheDocument()
  })

  it('renders both left and right icons', () => {
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

  it('calls onClick handler', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click</Button>)

    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalled()
  })

  it('applies custom className', () => {
    const { container } = render(<Button className="custom-class">Button</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('custom-class')
  })

  it('applies base button styles', () => {
    const { container } = render(<Button>Button</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('inline-flex')
    expect(button).toHaveClass('items-center')
    expect(button).toHaveClass('justify-center')
    expect(button).toHaveClass('font-semibold')
    expect(button).toHaveClass('transition-all')
  })

  it('applies disabled state styles', () => {
    const { container } = render(<Button disabled>Disabled</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('disabled:opacity-50')
    expect(button).toHaveClass('disabled:cursor-not-allowed')
    expect(button).toHaveClass('disabled:pointer-events-none')
  })

  it('supports all button HTML attributes', () => {
    render(
      <Button
        type="submit"
        name="test-button"
        data-testid="custom-button"
      >
        Submit
      </Button>
    )

    const button = screen.getByTestId('custom-button')
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toHaveAttribute('name', 'test-button')
  })

  it('loading spinner has correct styling', () => {
    const { container } = render(<Button loading>Loading</Button>)

    const spinner = container.querySelector('span[class*="animate-spin"]')
    expect(spinner).toHaveClass('h-4')
    expect(spinner).toHaveClass('w-4')
    expect(spinner).toHaveClass('rounded-full')
    expect(spinner).toHaveClass('border-2')
    expect(spinner).toHaveClass('border-current')
    expect(spinner).toHaveClass('border-t-transparent')
  })

  it('primary variant has hover state', () => {
    const { container } = render(<Button variant="primary">Button</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('hover:bg-brand-700')
  })

  it('primary variant has active state', () => {
    const { container } = render(<Button variant="primary">Button</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('active:bg-brand-800')
  })

  it('secondary variant has border', () => {
    const { container } = render(<Button variant="secondary">Button</Button>)

    const button = container.querySelector('button')
    expect(button).toHaveClass('border')
    expect(button).toHaveClass('border-border')
  })

  it('ghost variant does not have background', () => {
    const { container } = render(<Button variant="ghost">Button</Button>)

    const button = container.querySelector('button')
    expect(button).not.toHaveClass('bg-')
  })

  it('icon spacing respects size', () => {
    const { container: container1 } = render(
      <Button size="sm" leftIcon={<span>I</span>}>
        Small
      </Button>
    )

    const button1 = container1.querySelector('button')
    expect(button1).toHaveClass('gap-1.5')

    const { container: container2 } = render(
      <Button size="md" leftIcon={<span>I</span>}>
        Medium
      </Button>
    )

    const button2 = container2.querySelector('button')
    expect(button2).toHaveClass('gap-2')
  })

  it('preserves button semantics', () => {
    const { container } = render(<Button>Semantic</Button>)

    const button = container.querySelector('button')
    expect(button).toBeInstanceOf(HTMLButtonElement)
  })
})
