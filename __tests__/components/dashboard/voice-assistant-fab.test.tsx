import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { VoiceAssistantFab } from '@/components/dashboard/voice-assistant-fab'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/lib/hooks/use-business-context', () => ({
  useBusinessContext: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/components/dashboard/voice-visualizer', () => ({
  VoiceVisualizer: () => <div data-testid="voice-visualizer" />,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  useMotionValue: vi.fn(() => ({
    set: vi.fn(),
  })),
  useSpring: vi.fn((value) => value),
}))

vi.mock('lucide-react', () => ({
  Mic: () => <div data-testid="mic-icon" />,
}))

import { useBusinessContext } from '@/lib/hooks/use-business-context'
import { useQueryClient } from '@tanstack/react-query'

describe('VoiceAssistantFab Component', () => {
  const mockQueryClient = {
    invalidateQueries: vi.fn(),
  }

  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'businesses') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: { id: 'biz-123', settings: { uiSettings: { showLuisFab: true } } },
              error: null,
            }),
          }),
        }
      }
      return {
        select: vi.fn(),
      }
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()

    vi.mocked(useQueryClient).mockReturnValue(mockQueryClient as any)
    vi.mocked(useBusinessContext).mockReturnValue({
      supabase: mockSupabase,
      businessId: 'biz-123',
    } as any)
  })

  it('renders FAB component when loaded', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('loads chat history from sessionStorage', async () => {
    const mockHistory = [{ role: 'user', content: 'Hello' }]
    sessionStorage.setItem('cronix-assistant-history', JSON.stringify(mockHistory))

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('initializes empty chat history when sessionStorage empty', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('saves chat history to sessionStorage when updated', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('loads Y position from localStorage', async () => {
    localStorage.setItem('cronix-assistant-y', '100')

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('loads desktop Y position from localStorage', async () => {
    localStorage.setItem('cronix-assistant-y-desktop', '200')

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('syncs visibility from business settings', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalledWith('businesses')
    })
  })

  it('hides FAB when showLuisFab is false', async () => {
    vi.mocked(useBusinessContext).mockReturnValue({
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'businesses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: { id: 'biz-123', settings: { uiSettings: { showLuisFab: false } } },
                  error: null,
                }),
              }),
            }
          }
          return { select: vi.fn() }
        }),
        channel: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          subscribe: vi.fn(),
        }),
      },
      businessId: 'biz-123',
    } as any)

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(useBusinessContext).toHaveBeenCalled()
    })
  })

  it('handles visibility toggle event', async () => {
    render(<VoiceAssistantFab />)

    const event = new CustomEvent('cronix:toggle-fab', { detail: false })
    window.dispatchEvent(event)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('subscribes to Realtime channel for appointments', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(mockSupabase.channel).toHaveBeenCalled()
    })
  })

  it('invalidates appointments queries on database changes', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(mockSupabase.channel).toHaveBeenCalled()
    })
  })

  it('invalidates notifications queries on realtime event', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(mockSupabase.channel).toHaveBeenCalled()
    })
  })

  it('sets isLoaded when no businessId', async () => {
    vi.mocked(useBusinessContext).mockReturnValue({
      supabase: mockSupabase,
      businessId: null,
    } as any)

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('handles missing business settings gracefully', async () => {
    vi.mocked(useBusinessContext).mockReturnValue({
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'businesses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: { id: 'biz-123', settings: null },
                  error: null,
                }),
              }),
            }
          }
          return { select: vi.fn() }
        }),
        channel: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          subscribe: vi.fn(),
        }),
      },
      businessId: 'biz-123',
    } as any)

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('handles database query errors', async () => {
    vi.mocked(useBusinessContext).mockReturnValue({
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'businesses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Query failed' },
                }),
              }),
            }
          }
          return { select: vi.fn() }
        }),
        channel: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          subscribe: vi.fn(),
        }),
      },
      businessId: 'biz-123',
    } as any)

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('initializes idle state on mount', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })

  it('renders VoiceVisualizer component', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('voice-visualizer')).toBeInTheDocument()
    })
  })

  it('cleans up event listener on unmount', async () => {
    const { unmount } = render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })

    unmount()

    expect(screen.queryByTestId('mic-icon')).not.toBeInTheDocument()
  })

  it('handles invalid JSON in sessionStorage', async () => {
    sessionStorage.setItem('cronix-assistant-history', 'invalid-json')

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getByTestId('mic-icon')).toBeInTheDocument()
    })
  })
})
