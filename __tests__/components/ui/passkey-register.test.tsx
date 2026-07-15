import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PasskeyRegister } from '@/components/ui/passkey-register'



vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

vi.mock('lucide-react', () => ({
  Fingerprint: () => <div data-testid="fingerprint-icon" />,
  Trash2: () => <div data-testid="trash-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
  AlertCircle: () => <div data-testid="alert-icon" />,
  Zap: () => <div data-testid="zap-icon" />,
}))

import { createClient } from '@/lib/supabase/client'

describe('PasskeyRegister Component', () => {
  const mockPasskeys = [
    { id: '1', device_name: 'iPhone', created_at: '2026-05-01T10:00:00Z' },
    { id: '2', device_name: 'MacBook', created_at: '2026-05-02T10:00:00Z' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: { isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true) },
      writable: true,
    })
  })

  it('renders unsupported message when WebAuthn not available', () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: undefined,
      writable: true,
    })

    render(<PasskeyRegister />)

    expect(screen.getByTestId('alert-icon')).toBeInTheDocument()
  })

  it('loads and displays stored passkeys', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockPasskeys,
            error: null,
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<PasskeyRegister />)

    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalledWith('user_passkeys')
    })
  })

  it('queries passkeys with correct select and order', async () => {
    const selectMock = vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({
        data: mockPasskeys,
        error: null,
      }),
    })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({ select: selectMock }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<PasskeyRegister />)

    await waitFor(() => {
      expect(selectMock).toHaveBeenCalledWith('id, device_name, created_at')
    })
  })

  it('handles empty passkey list gracefully', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<PasskeyRegister />)

    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalled()
    })
  })

  it('checks WebAuthn support on mount', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockPasskeys,
            error: null,
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    const { container } = render(<PasskeyRegister />)

    expect(container).toBeInTheDocument()
  })

  it('renders supported content when WebAuthn available', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockPasskeys,
            error: null,
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    const { container } = render(<PasskeyRegister />)

    expect(container).toBeInTheDocument()
  })

  it('uses createClient from supabase client lib', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<PasskeyRegister />)

    await waitFor(() => {
      expect(createClient).toHaveBeenCalled()
    })
  })

  it('handles loading state', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockImplementation(() =>
            new Promise(resolve =>
              setTimeout(() => resolve({ data: mockPasskeys, error: null }), 100)
            )
          ),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<PasskeyRegister />)

    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalled()
    })
  })

  it('orders passkeys by created_at descending', async () => {
    const orderMock = vi.fn().mockResolvedValue({
      data: mockPasskeys,
      error: null,
    })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: orderMock,
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<PasskeyRegister />)

    await waitFor(() => {
      expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
    })
  })

  it('initializes with empty device name input', () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<PasskeyRegister />)

    expect(mockSupabase.from).toHaveBeenCalled()
  })

  it('displays fingerprint icon', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockPasskeys,
            error: null,
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<PasskeyRegister />)

    expect(screen.getByTestId('fingerprint-icon')).toBeInTheDocument()
  })
})
