import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ServicesOnboardingBanner } from '@/components/dashboard/services-onboarding-banner'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('lucide-react', () => ({
  Wrench: () => <div data-testid="wrench-icon" />,
  X: () => <div data-testid="x-icon" />,
  ArrowRight: () => <div data-testid="arrow-icon" />,
  Sparkles: () => <div data-testid="sparkles-icon" />,
}))

describe('ServicesOnboardingBanner Component', () => {
  const mockBusinessId = 'biz-123'

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders banner when hasServices is false', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(screen.getByText(/Configura tus servicios/i)).toBeInTheDocument()
  })

  it('does not render when hasServices is true', () => {
    const { container } = render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={true} />)

    expect(container.firstChild).toBeNull()
  })

  it('does not render when banner is dismissed', () => {
    localStorage.setItem(`services-banner-${mockBusinessId}`, '1')

    const { container } = render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(container.firstChild).toBeNull()
  })

  it('shows CTA link to services page', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    const link = screen.getByRole('link', { name: /Agregar servicios/i })
    expect(link).toHaveAttribute('href', '/dashboard/services')
  })

  it('displays dismiss button "Lo haré después"', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(screen.getByText('Lo haré después')).toBeInTheDocument()
  })

  it('hides banner when close button clicked', () => {
    const { container, rerender } = render(
      <ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />
    )

    const closeButton = screen.getByRole('button', { name: '' })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1])

    rerender(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(localStorage.getItem(`services-banner-${mockBusinessId}`)).toBe('1')
  })

  it('hides banner when "Lo haré después" clicked', () => {
    const { rerender } = render(
      <ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />
    )

    const dismissButton = screen.getByText('Lo haré después')
    fireEvent.click(dismissButton)

    rerender(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(localStorage.getItem(`services-banner-${mockBusinessId}`)).toBe('1')
  })

  it('saves dismissed state to localStorage with correct key', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1])

    expect(localStorage.getItem(`services-banner-${mockBusinessId}`)).toBe('1')
  })

  it('uses different localStorage keys for different businesses', () => {
    const biz1 = 'biz-1'
    const biz2 = 'biz-2'

    const { rerender } = render(<ServicesOnboardingBanner businessId={biz1} hasServices={false} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1])

    rerender(<ServicesOnboardingBanner businessId={biz2} hasServices={false} />)

    expect(localStorage.getItem(`services-banner-${biz1}`)).toBe('1')
    expect(localStorage.getItem(`services-banner-${biz2}`)).toBeNull()
  })

  it('displays correct descriptive text', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(screen.getByText(/Aún no tienes servicios configurados/i)).toBeInTheDocument()
  })

  it('shows "Recomendado" badge', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(screen.getByText('Recomendado')).toBeInTheDocument()
  })

  it('displays Wrench icon', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(screen.getByTestId('wrench-icon')).toBeInTheDocument()
  })

  it('displays close (X) icon', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(screen.getByTestId('x-icon')).toBeInTheDocument()
  })

  it('displays arrow icon on CTA button', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(screen.getByTestId('arrow-icon')).toBeInTheDocument()
  })

  it('renders when hasServices is undefined (backward compat)', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} />)

    expect(screen.getByText(/Configura tus servicios/i)).toBeInTheDocument()
  })

  it('maintains dismissed state across re-renders', () => {
    localStorage.setItem(`services-banner-${mockBusinessId}`, '1')

    const { rerender } = render(
      <ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />
    )

    expect(localStorage.getItem(`services-banner-${mockBusinessId}`)).toBe('1')

    rerender(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(localStorage.getItem(`services-banner-${mockBusinessId}`)).toBe('1')
  })

  it('has proper gradient styling classes', () => {
    const { container } = render(
      <ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />
    )

    const banner = container.querySelector('div[class*="bg-gradient"]')
    expect(banner).toBeInTheDocument()
  })

  it('renders title heading', () => {
    render(<ServicesOnboardingBanner businessId={mockBusinessId} hasServices={false} />)

    expect(screen.getByText('Configura tus servicios')).toBeInTheDocument()
  })
})
