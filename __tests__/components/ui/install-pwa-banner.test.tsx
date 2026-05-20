/**
 * components/ui/pwa-install-banner.tsx — PWA Install Banner Tests
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PwaInstallBanner } from '@/components/ui/pwa-install-banner'

vi.mock('@/lib/hooks/use-pwa-install', () => ({
  usePwaInstall: () => ({
    isInstallable: true,
    onInstall: vi.fn(),
  }),
}))

describe('PwaInstallBanner Component', () => {
  it('renders banner when installable', () => {
    render(<PwaInstallBanner />)
    expect(screen.getByRole('banner') || screen.getByText(/install/i)).toBeInTheDocument()
  })

  it('shows install button', () => {
    render(<PwaInstallBanner />)
    const button = screen.getByRole('button', { name: /install/i })
    expect(button).toBeInTheDocument()
  })

  it('handles install click', () => {
    render(<PwaInstallBanner />)
    const button = screen.getByRole('button', { name: /install/i })
    fireEvent.click(button)
  })

  it('shows close button', () => {
    render(<PwaInstallBanner />)
    const closeButton = screen.getByRole('button', { name: /close|×/i })
    expect(closeButton).toBeInTheDocument()
  })

  it('hides banner when not installable', () => {
    vi.mocked(require('@/lib/hooks/use-pwa-install').usePwaInstall).mockReturnValue({
      isInstallable: false,
      onInstall: vi.fn(),
    })

    const { container } = render(<PwaInstallBanner />)
    expect(container.firstChild).toBeEmptyDOMElement()
  })
})
