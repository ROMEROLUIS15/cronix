import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PwaUpdateToast } from '@/components/ui/pwa-update-toast'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/lib/hooks/use-pwa-update', () => ({
  usePwaUpdate: vi.fn(),
}))

vi.mock('lucide-react', () => ({
  RefreshCw: () => <div data-testid="refresh-icon" />,
}))

import { usePwaUpdate } from '@/lib/hooks/use-pwa-update'

describe('PwaUpdateToast Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no update available', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: false,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    expect(container.firstChild).toBeNull()
  })

  it('renders toast when update available', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    expect(container.firstChild).not.toBeNull()
  })

  it('displays refresh icon', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    render(<PwaUpdateToast />)

    expect(screen.getByTestId('refresh-icon')).toBeInTheDocument()
  })

  it('displays update button', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    render(<PwaUpdateToast />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('calls applyUpdate when button clicked', () => {
    const applyUpdateMock = vi.fn()

    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: applyUpdateMock,
    })

    render(<PwaUpdateToast />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(applyUpdateMock).toHaveBeenCalled()
  })

  it('has fixed positioning', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    const toast = container.querySelector('[role="status"]')
    expect(toast).toHaveClass('fixed')
    expect(toast).toHaveClass('bottom-6')
    expect(toast).toHaveClass('right-4')
  })

  it('has high z-index', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    const toast = container.querySelector('[role="status"]')
    expect(toast).toHaveClass('z-50')
  })

  it('has accessibility role status', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    render(<PwaUpdateToast />)

    const toast = screen.getByRole('status')
    expect(toast).toBeInTheDocument()
  })

  it('has aria-live polite', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    const toast = container.querySelector('[aria-live="polite"]')
    expect(toast).toBeInTheDocument()
  })

  it('has responsive width', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    const toast = container.querySelector('[role="status"]')
    expect(toast).toHaveStyle('maxWidth: 320px')
    expect(toast).toHaveStyle('width: calc(100vw - 2rem)')
  })

  it('displays title text', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    render(<PwaUpdateToast />)

    expect(screen.getByText('toastTitle')).toBeInTheDocument()
  })

  it('displays description text', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    render(<PwaUpdateToast />)

    expect(screen.getByText('toastDesc')).toBeInTheDocument()
  })

  it('displays button text', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    render(<PwaUpdateToast />)

    expect(screen.getByText('toastBtn')).toBeInTheDocument()
  })

  it('applies dark theme styling', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    const toastContent = container.querySelector('[class*="rounded-2xl"]')
    expect(toastContent).toBeInTheDocument()
  })

  it('has glass morphism effect', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    const toastContent = container.querySelector('div[style*="backdropFilter"]')
    expect(toastContent).toBeInTheDocument()
  })

  it('has fade-in animation', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    const { container } = render(<PwaUpdateToast />)

    const toast = container.querySelector('[role="status"]')
    expect(toast).toHaveClass('animate-fade-in')
  })

  it('button scales on click', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    render(<PwaUpdateToast />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('active:scale-95')
  })

  it('button has hover effect', () => {
    vi.mocked(usePwaUpdate).mockReturnValue({
      updateAvailable: true,
      applyUpdate: vi.fn(),
    })

    render(<PwaUpdateToast />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('hover:brightness-110')
  })
})
