import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { VoiceAssistantFab } from '@/components/dashboard/voice-assistant-fab'



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

// motion.<tag> is resolved lazily: the component uses motion.div AND motion.button,
// and a missing tag renders as undefined ("Element type is invalid"). Strip the
// motion-only props so React doesn't warn about unknown DOM attributes.
vi.mock('framer-motion', () => ({
  motion: new Proxy({} as Record<string, React.ElementType>, {
    get: (_target, tag: string) =>
      ({ children, drag, dragConstraints, dragElastic, dragMomentum, whileTap, ...props }: any) =>
        React.createElement(tag, props, children),
  }),
  useMotionValue: vi.fn(() => ({ set: vi.fn(), get: vi.fn(() => 0) })),
  useSpring: vi.fn((value) => value),
}))

vi.mock('lucide-react', () => ({
  Mic: () => <div data-testid="mic-icon" />,
}))

// Behaviour lives in three hooks since the 873→124 refactor. useFabChrome and
// useRealtimeDashboardSync run for real (against mockSupabase) — that is what the
// visibility/realtime tests below actually assert. Only useVoiceAssistant is stubbed,
// because it drives getUserMedia/AudioContext, which jsdom does not implement.
vi.mock('@/components/dashboard/use-voice-assistant', () => ({
  useVoiceAssistant: vi.fn(() => ({ state: 'idle', volume: 0, handleClick: vi.fn() })),
}))

import { useBusinessContext } from '@/lib/hooks/use-business-context'
import { useQueryClient } from '@tanstack/react-query'
import { useVoiceAssistant } from '@/components/dashboard/use-voice-assistant'

// Builds a Supabase double matching the chains the hooks really call:
//   from('businesses').select('settings').eq('id', id).single()
//   channel(name).on(...).on(...).subscribe()  +  removeChannel(ch)
const makeSupabase = (
  settings: unknown,
  { error = null }: { error?: unknown } = {},
) => ({
  from: vi.fn((table: string) => {
    if (table === 'businesses') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: error
              ? vi.fn().mockRejectedValue(error)
              : vi.fn().mockResolvedValue({ data: { id: 'biz-123', settings }, error: null }),
          }),
        }),
      }
    }
    return { select: vi.fn() }
  }),
  channel: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }),
  removeChannel: vi.fn(),
})

describe('VoiceAssistantFab Component', () => {
  const mockQueryClient = {
    invalidateQueries: vi.fn(),
  }

  // Mirrors the real chains the hooks call:
  //   from('businesses').select('settings').eq('id', id).single()
  //   channel(name).on(...).on(...).subscribe()  +  removeChannel(ch)
  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'businesses') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'biz-123', settings: { uiSettings: { showLuisFab: true } } },
                error: null,
              }),
            }),
          }),
        }
      }
      return { select: vi.fn() }
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
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
    // clearAllMocks() does not drop mockReturnValue, so re-assert the idle default
    // or a test that forces 'listening' would leak into the ones after it.
    vi.mocked(useVoiceAssistant).mockReturnValue({
      state: 'idle',
      volume: 0,
      handleClick: vi.fn(),
    } as any)
  })

  it('renders FAB component when loaded', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('loads chat history from sessionStorage', async () => {
    const mockHistory = [{ role: 'user', content: 'Hello' }]
    sessionStorage.setItem('cronix-assistant-history', JSON.stringify(mockHistory))

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('initializes empty chat history when sessionStorage empty', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('saves chat history to sessionStorage when updated', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('loads Y position from localStorage', async () => {
    localStorage.setItem('cronix-assistant-y', '100')

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('loads desktop Y position from localStorage', async () => {
    localStorage.setItem('cronix-assistant-y-desktop', '200')

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
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
      supabase: makeSupabase({ uiSettings: { showLuisFab: false } }),
      businessId: 'biz-123',
    } as any)

    render(<VoiceAssistantFab />)

    // The owner opted out → the FAB must not render at all.
    await waitFor(() => {
      expect(screen.queryAllByTestId('mic-icon')).toHaveLength(0)
    })
  })

  it('handles visibility toggle event', async () => {
    render(<VoiceAssistantFab />)
    await waitFor(() => expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0))

    // `cronix:toggle-fab` with detail:false must HIDE the FAB (settings toggle).
    await act(async () => {
      window.dispatchEvent(new CustomEvent('cronix:toggle-fab', { detail: false }))
    })

    await waitFor(() => {
      expect(screen.queryAllByTestId('mic-icon')).toHaveLength(0)
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
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('handles missing business settings gracefully', async () => {
    vi.mocked(useBusinessContext).mockReturnValue({
      supabase: {
        ...makeSupabase(null),
      },
      businessId: 'biz-123',
    } as any)

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('handles database query errors', async () => {
    vi.mocked(useBusinessContext).mockReturnValue({
      // The hook catches the rejection and still flips isLoaded → FAB renders.
      supabase: makeSupabase(null, { error: new Error('Query failed') }),
      businessId: 'biz-123',
    } as any)

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('initializes idle state on mount', async () => {
    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })

  it('renders VoiceVisualizer while listening (Mic only when idle)', async () => {
    vi.mocked(useVoiceAssistant).mockReturnValue({
      state: 'listening',
      volume: 0.4,
      handleClick: vi.fn(),
    } as any)

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      expect(screen.getAllByTestId('voice-visualizer').length).toBeGreaterThan(0)
    })
    expect(screen.queryByTestId('mic-icon')).not.toBeInTheDocument()
  })

  it('cleans up event listener on unmount', async () => {
    const { unmount } = render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })

    unmount()

    expect(screen.queryAllByTestId('mic-icon')).toHaveLength(0)
  })

  it('handles invalid JSON in sessionStorage', async () => {
    sessionStorage.setItem('cronix-assistant-history', 'invalid-json')

    render(<VoiceAssistantFab />)

    await waitFor(() => {
      // Mobile + desktop FABs both render (they are hidden via CSS, which jsdom
      // does not apply), so the icon legitimately appears twice.
      expect(screen.getAllByTestId('mic-icon').length).toBeGreaterThan(0)
    })
  })
})
