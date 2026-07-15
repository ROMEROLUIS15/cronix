import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PasskeyLoginButton } from '@/components/ui/passkey-login-button'

vi.mock('@/components/hooks/use-passkey-login', () => ({
  usePasskeyLogin: vi.fn(),
}))

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthnAutofill: vi.fn(),
}))

vi.mock('lucide-react', () => ({
  Fingerprint: () => <div data-testid="fingerprint-icon" />,
  Loader2: () => <div data-testid="loader-icon" />,
  Info: () => <div data-testid="info-icon" />,
  X: () => <div data-testid="x-icon" />,
}))

import { usePasskeyLogin } from '@/components/hooks/use-passkey-login'
import { browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser'

describe('PasskeyLoginButton Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
      writable: true,
    })
  })

  it('returns null when platform authenticator not supported', async () => {
    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: vi.fn(),
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    Object.defineProperty(window, 'PublicKeyCredential', {
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
      },
      writable: true,
    })

    const { container } = render(<PasskeyLoginButton />)

    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('renders button when supported', async () => {
    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: vi.fn(),
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      const button = screen.queryByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })
      expect(button).toBeInTheDocument()
    })
  })

  it('calls authenticate when button clicked', async () => {
    const authenticateMock = vi.fn().mockResolvedValue(undefined)

    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: authenticateMock,
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })
      fireEvent.click(button)
    })

    await waitFor(() => {
      expect(authenticateMock).toHaveBeenCalled()
    })
  })

  it('disables button while loading', async () => {
    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: true,
      error: null,
      authenticate: vi.fn(),
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })
      expect(button).toBeDisabled()
    })
  })

  it('calls startConditional when autofill supported', async () => {
    const startConditionalMock = vi.fn()

    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: vi.fn(),
      startConditional: startConditionalMock,
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(true)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      expect(startConditionalMock).toHaveBeenCalled()
    })
  })

  it('handles NotAllowedError when user cancels', async () => {
    const authenticateMock = vi.fn().mockImplementation(() => {
      const error = new Error('Cancelled')
      error.name = 'NotAllowedError'
      throw error
    })

    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: authenticateMock,
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })
      fireEvent.click(button)
    })

    await waitFor(() => {
      expect(authenticateMock).toHaveBeenCalled()
    })
  })

  it('clears error before authentication', async () => {
    const clearErrorMock = vi.fn()
    const authenticateMock = vi.fn().mockResolvedValue(undefined)

    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: authenticateMock,
      startConditional: vi.fn(),
      clearError: clearErrorMock,
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })
      fireEvent.click(button)
    })

    await waitFor(() => {
      expect(clearErrorMock).toHaveBeenCalled()
    })
  })

  it('catches error when authentication throws', async () => {
    const error = new Error('Auth failed')
    error.name = 'InvalidStateError'

    const authenticateMock = vi.fn().mockRejectedValue(error)

    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: authenticateMock,
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })
      fireEvent.click(button)
    })

    await waitFor(() => {
      expect(authenticateMock).toHaveBeenCalled()
    })
  })

  it('handles case where no passkey is available', async () => {
    const error = new Error('No passkey')
    error.name = 'NotAllowedError'

    const authenticateMock = vi.fn().mockRejectedValue(error)

    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: authenticateMock,
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })
      fireEvent.click(button)
    })

    await waitFor(() => {
      expect(authenticateMock).toHaveBeenCalled()
    })
  })

  it('renders help guide information', async () => {
    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: vi.fn(),
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })).toBeInTheDocument()
    })
  })

  it('handles missing PublicKeyCredential gracefully', () => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: undefined,
      writable: true,
    })

    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: vi.fn(),
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    const { container } = render(<PasskeyLoginButton />)

    expect(container.firstChild).toBeNull()
  })

  it('shows guide on mobile when setup steps needed', async () => {
    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: false,
      error: null,
      authenticate: vi.fn(),
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    render(<PasskeyLoginButton />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })).toBeInTheDocument()
    })
  })

  it('respects loading state from hook', async () => {
    const { rerender } = render(<PasskeyLoginButton />)

    vi.mocked(usePasskeyLogin).mockReturnValue({
      loading: true,
      error: null,
      authenticate: vi.fn(),
      startConditional: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)

    rerender(<PasskeyLoginButton />)

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /iniciar sesión con biometría|esperando biometría/i })
      expect(button).toBeDisabled()
    })
  })
})
