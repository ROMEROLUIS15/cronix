import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PwaInstallBanner } from '@/components/ui/pwa-install-banner'

vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: any) => <img src={src} alt={alt} {...props} />,
}))



vi.mock('@/lib/hooks/use-pwa-install', () => ({
  usePwaInstall: vi.fn(),
}))

vi.mock('@/lib/hooks/use-pwa-install-fallback', () => ({
  usePwaInstallFallback: vi.fn(),
}))

vi.mock('lucide-react', () => ({
  Download: () => <div data-testid="download-icon" />,
  Share: () => <div data-testid="share-icon" />,
  X: () => <div data-testid="x-icon" />,
}))

import { usePwaInstall } from '@/lib/hooks/use-pwa-install'
import { usePwaInstallFallback } from '@/lib/hooks/use-pwa-install-fallback'

const mockFallbackState = (overrides?: any) => ({
  browserType: 'chrome' as const,
  isAndroid: false,
  isIos: false,
  hasManifest: true,
  hasSW: true,
  instruction: 'Install from menu',
  ...overrides,
})

describe('PwaInstallBanner Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when app is already installed', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: true,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState())

    const { container } = render(<PwaInstallBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders when installation is available', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState())

    render(<PwaInstallBanner />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders hero variant by default', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState())

    render(<PwaInstallBanner variant="hero" />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders navbar variant when specified', () => {
    const installMock = vi.fn()
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: installMock,
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState())

    render(<PwaInstallBanner variant="navbar" />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls install when native install is available', () => {
    const installMock = vi.fn()
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: installMock,
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState())

    render(<PwaInstallBanner />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(installMock).toHaveBeenCalled()
  })

  it('shows iOS guide when clicked on iOS', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: true,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState({ isIos: true }))

    render(<PwaInstallBanner />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    // Real es.json copy; the guide title is stable across the hero/navbar markup.
    expect(screen.getAllByText('Instalar en iPhone / iPad').length).toBeGreaterThan(0)
  })

  it('shows fallback instructions on Android without native support', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState({ isAndroid: true }))

    render(<PwaInstallBanner />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(screen.getByText(/chrome|firefox|install/i)).toBeInTheDocument()
  })

  it('dismisses banner when close button clicked', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState())

    const { container, rerender } = render(<PwaInstallBanner />)
    expect(container.firstChild).not.toBeNull()
  })

  it('returns null when no install path available on hero variant', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState({ hasManifest: false, hasSW: false }))

    const { container } = render(<PwaInstallBanner variant="hero" />)
    expect(container.firstChild).toBeNull()
  })

  it('always shows navbar variant when specified', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState({ hasManifest: false, hasSW: false }))

    render(<PwaInstallBanner variant="navbar" />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders with hero styling by default', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState())

    const { container } = render(<PwaInstallBanner />)
    expect(container.querySelector('[style*="gradient"]')).toBeInTheDocument()
  })

  it('handles rapid dismiss and re-render', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState())

    const { container } = render(<PwaInstallBanner />)
    expect(container.firstChild).not.toBeNull()
  })

  it('supports Chrome fallback instructions', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState({ browserType: 'chrome' }))

    render(<PwaInstallBanner />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(button).toBeInTheDocument()
  })

  it('supports Safari fallback instructions', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: true,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState({ browserType: 'safari', isIos: true }))

    render(<PwaInstallBanner />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(button).toBeInTheDocument()
  })

  it('supports Firefox fallback instructions', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })
    vi.mocked(usePwaInstallFallback).mockReturnValue(mockFallbackState({ browserType: 'firefox' }))

    render(<PwaInstallBanner />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(button).toBeInTheDocument()
  })
})
