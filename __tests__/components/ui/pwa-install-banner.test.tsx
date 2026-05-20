import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PwaInstallBanner } from '@/components/ui/pwa-install-banner'

vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: any) => <img src={src} alt={alt} {...props} />,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    const { container } = render(<PwaInstallBanner />)

    expect(container.firstChild).toBeNull()
  })

  it('returns null when dismissed', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    const { container } = render(<PwaInstallBanner />)

    expect(container.firstChild).not.toBeNull()
  })

  it('renders hero variant by default', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    const { container } = render(<PwaInstallBanner />)

    expect(container.firstChild).not.toBeNull()
  })

  it('renders navbar variant when specified', () => {
    const installMock = vi.fn()

    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: installMock,
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    const { container } = render(<PwaInstallBanner variant="navbar" />)

    expect(container.firstChild).not.toBeNull()
  })

  it('calls install when native prompt available', async () => {
    const installMock = vi.fn().mockResolvedValue(undefined)

    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: installMock,
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    render(<PwaInstallBanner variant="navbar" />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(installMock).toHaveBeenCalled()
  })

  it('shows iOS guide when on iOS', async () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: true,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: true,
      hasManifest: true,
      hasSW: true,
    })

    render(<PwaInstallBanner variant="navbar" />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(button).toBeInTheDocument()
  })

  it('shows fallback guide for Android without native prompt', async () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    render(<PwaInstallBanner variant="navbar" />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('renders download icon', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    render(<PwaInstallBanner variant="navbar" />)

    expect(screen.getByTestId('download-icon')).toBeInTheDocument()
  })

  it('hides on hero variant when no install path available', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: false,
      hasSW: false,
    })

    const { container } = render(<PwaInstallBanner variant="hero" />)

    expect(container.firstChild).toBeNull()
  })

  it('shows on navbar variant even without native prompt', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: false,
      hasSW: false,
    })

    const { container } = render(<PwaInstallBanner variant="navbar" />)

    expect(container.firstChild).not.toBeNull()
  })

  it('has correct button id for navbar variant', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    const { container } = render(<PwaInstallBanner variant="navbar" />)

    const button = container.querySelector('#pwa-navbar-install-btn')
    expect(button).toBeInTheDocument()
  })

  it('applies gradient styling', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    const { container } = render(<PwaInstallBanner variant="navbar" />)

    const button = container.querySelector('button')
    expect(button).toHaveStyle('background: linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)')
  })

  it('applies box shadow styling', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isIos: false,
      isInstalled: false,
      install: vi.fn(),
    })

    vi.mocked(usePwaInstallFallback).mockReturnValue({
      isIos: false,
      hasManifest: true,
      hasSW: true,
    })

    const { container } = render(<PwaInstallBanner variant="navbar" />)

    const button = container.querySelector('button')
    expect(button).toHaveStyle('boxShadow: 0 0 20px rgba(56,132,255,0.25)')
  })
})
