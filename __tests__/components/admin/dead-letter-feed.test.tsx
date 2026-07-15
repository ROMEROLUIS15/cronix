import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DeadLetterFeed } from '@/components/admin/dead-letter-feed'

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

vi.mock('date-fns', () => ({
  formatDistanceToNow: vi.fn((date: string) => '2 days ago'),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div data-testid="card" {...props}>{children}</div>,
}))

vi.mock('lucide-react', () => ({
  Database: () => <div data-testid="database-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
  Phone: () => <div data-testid="phone-icon" />,
  AlertCircle: () => <div data-testid="alert-icon" />,
  ChevronRight: () => <div data-testid="chevron-right-icon" />,
  Bug: () => <div data-testid="bug-icon" />,
  ExternalLink: () => <div data-testid="external-link-icon" />,
  ChevronDown: () => <div data-testid="chevron-down-icon" />,
}))

import { createClient } from '@/lib/supabase/client'

describe('DeadLetterFeed Component', () => {
  const mockDLQEntries = [
    {
      id: '1',
      payload: { message: 'Test message 1' },
      error: 'Connection timeout',
      service_type: 'whatsapp',
      retry_count: 3,
      created_at: '2026-05-17T10:00:00Z',
    },
    {
      id: '2',
      payload: { message: 'Test message 2' },
      error: 'Invalid format',
      service_type: 'sms',
      retry_count: 1,
      created_at: '2026-05-18T10:00:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading skeleton initially', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() =>
              new Promise(resolve =>
                setTimeout(() => resolve({ data: mockDLQEntries, error: null }), 100)
              )
            ),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    const { container } = render(<DeadLetterFeed />)

    const skeletons = container.querySelectorAll('[class*="animate-pulse"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('loads DLQ entries from Supabase', async () => {
    const selectMock = vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: mockDLQEntries,
          error: null,
        }),
      }),
    })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({ select: selectMock }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(selectMock).toHaveBeenCalledWith('*')
    })
  })

  it('queries with correct order and limit', async () => {
    const limitMock = vi.fn().mockResolvedValue({
      data: mockDLQEntries,
      error: null,
    })

    const orderMock = vi.fn().mockReturnValue({ limit: limitMock })

    const selectMock = vi.fn().mockReturnValue({ order: orderMock })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({ select: selectMock }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
      expect(limitMock).toHaveBeenCalledWith(20)
    })
  })

  it('displays empty state when no entries', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(screen.getByText('Sin fallos en cola')).toBeInTheDocument()
    })
  })

  it('subscribes to Realtime channel on mount', async () => {
    const onMock = vi.fn().mockReturnThis()
    const subscribeMock = vi.fn()
    const channelMock = {
      on: onMock,
      subscribe: subscribeMock,
    }

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: mockDLQEntries,
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue(channelMock),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(mockSupabase.channel).toHaveBeenCalledWith('dlq-admin-feed')
    })
  })

  it('listens for postgres_changes on wa_dead_letter_queue', async () => {
    const onMock = vi.fn().mockReturnThis()
    const subscribeMock = vi.fn()

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: mockDLQEntries,
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: onMock,
        subscribe: subscribeMock,
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(onMock).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({
          event: '*',
          schema: 'public',
          table: 'wa_dead_letter_queue',
        }),
        expect.any(Function)
      )
    })
  })

  it('unsubscribes from channel on unmount', async () => {
    // subscribe() returns the channel (chain), which the component passes to
    // removeChannel — so the double must return `this`, not undefined.
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    const { unmount } = render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(mockSupabase.channel).toHaveBeenCalled()
    })

    unmount()

    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel)
  })

  it('handles query error gracefully', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Query failed' },
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(screen.getByText('Sin fallos en cola')).toBeInTheDocument()
    })
  })

  it('displays entries with correct structure', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: mockDLQEntries,
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    // Entries render as plain rows (no Card wrapper anymore); assert on the
    // error text each row shows so the test tracks real output.
    await waitFor(() => {
      expect(screen.getByText(/connection timeout/i)).toBeInTheDocument()
      expect(screen.getByText(/invalid format/i)).toBeInTheDocument()
    })
  })

  it('refetches on realtime event', async () => {
    let realtimeCallback: Function | null = null

    const onMock = vi.fn((event, filter, callback) => {
      if (event === 'postgres_changes') {
        realtimeCallback = callback
      }
      return { subscribe: vi.fn() }
    })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: mockDLQEntries,
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: onMock,
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(realtimeCallback).toBeDefined()
    })
  })

  it('limits results to 20 entries', async () => {
    const limitMock = vi.fn().mockResolvedValue({
      data: mockDLQEntries,
      error: null,
    })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: limitMock,
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(limitMock).toHaveBeenCalledWith(20)
    })
  })

  it('displays bug icon in empty state', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(screen.getByTestId('bug-icon')).toBeInTheDocument()
    })
  })

  it('creates supabase client on mount', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    }

    vi.mocked(createClient).mockReturnValue(mockSupabase as any)

    render(<DeadLetterFeed />)

    await waitFor(() => {
      expect(createClient).toHaveBeenCalled()
    })
  })
})
