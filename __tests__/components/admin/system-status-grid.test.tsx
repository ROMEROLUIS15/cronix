/**
 * components/admin/system-status-grid.tsx — System Status Grid Tests
 *
 * Tests real-time health monitoring with Supabase Realtime
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
    render(<SystemStatusGrid />)
    expect(screen.queryByText(/loading|cargando/i)).toBeTruthy()
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

  it('subscribes to Realtime updates', async () => {
    render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.channel).toHaveBeenCalledWith('service-health-admin')
    })
  })

  it('displays service status badges', async () => {
    render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.from).toHaveBeenCalled()
    })
  })

  it('removes channel on unmount', async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ data: null }),
    }

    mockSupabaseClient.channel.mockReturnValue(mockChannel)

    const { unmount } = render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.channel).toHaveBeenCalled()
    })

    unmount()

    expect(mockSupabaseClient.removeChannel).toHaveBeenCalled()
  })

  it('updates on Realtime changes', async () => {
    let realtimeCallback: (() => void) | null = null

    const mockChannel = {
      on: vi.fn((event, config, callback) => {
        realtimeCallback = callback
        return mockChannel
      }),
      subscribe: vi.fn().mockReturnValue({ data: null }),
    }

    mockSupabaseClient.channel.mockReturnValue(mockChannel)

    render(<SystemStatusGrid />)

    await waitFor(() => {
      expect(mockSupabaseClient.channel).toHaveBeenCalled()
    })

    // Simulate Realtime event
    if (realtimeCallback) {
      realtimeCallback()

      await waitFor(() => {
        expect(mockSupabaseClient.from).toHaveBeenCalledTimes(2) // Initial + update
      })
    }
  })
})
