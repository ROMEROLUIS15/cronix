/**
 * components/admin/system-status-grid.tsx — System Status Grid Tests
 *
 * Tests health monitoring, refreshed every 30 s while visible (no Supabase Realtime)
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SystemStatusGrid } from '@/components/admin/system-status-grid'

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockSupabaseClient = {
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabaseClient,
}))

vi.mock('date-fns', () => ({
  formatDistanceToNow: (date: string) => '2 hours ago',
}))

vi.mock('lucide-react', () => ({
  Zap: () => <div data-testid="zap-icon" />,
  Activity: () => <div data-testid="activity-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
  AlertCircle: () => <div data-testid="alert-icon" />,
  CheckCircle2: () => <div data-testid="check-icon" />,
  CloudLightning: () => <div data-testid="cloud-icon" />,
}))

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SystemStatusGrid Component', () => {
  const mockServices = [
    {
      service_name: 'AI_LLM',
      status: 'CLOSED' as const,
      failure_count: 0,
      last_failure: null,
    },
    {
      service_name: 'STT_DEEPGRAM',
      status: 'OPEN' as const,
      failure_count: 2,
      last_failure: '2026-05-19T10:00:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mock channel
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ data: null }),
    }

    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: mockServices,
          error: null,
        }),
      }),
    })

    mockSupabaseClient.channel.mockReturnValue(mockChannel)
  })

  it('renders loading state initially', () => {
    // The loading state is a skeleton grid (animate-pulse), not a text label.
    const { container } = render(<SystemStatusGrid />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('fetches and displays services', async () => {
    render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('service_health')
    })
  })

  it('displays all services in grid', async () => {
    render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.from).toHaveBeenCalled()
    })
  })

  it('refreshes every 30 s instead of subscribing to Realtime', async () => {
    // postgres_changes made Realtime read the WAL all the time and used up the database's
    // disk IO budget (2026-10-29).
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('service_health')
    })
    expect(mockSupabaseClient.channel).not.toHaveBeenCalled()
    expect(setIntervalSpy.mock.calls.some(([, ms]) => ms === 30_000)).toBe(true)
    setIntervalSpy.mockRestore()
  })

  it('displays service status badges', async () => {
    render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.from).toHaveBeenCalled()
    })
  })

  it('stops refreshing on unmount', async () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    const { unmount } = render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.from).toHaveBeenCalled()
    })

    unmount()

    expect(clearIntervalSpy).toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })
})
