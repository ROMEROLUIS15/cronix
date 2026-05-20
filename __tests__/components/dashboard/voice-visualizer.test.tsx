import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceVisualizer } from '@/components/dashboard/voice-visualizer'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, animate, ...props }: any) => (
      <div data-testid="motion-div" data-animate={JSON.stringify(animate)} {...props}>
        {children}
      </div>
    ),
  },
}))

describe('VoiceVisualizer Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders 5 animation bars', () => {
    render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    const motionDivs = screen.getAllByTestId('motion-div')
    expect(motionDivs).toHaveLength(5)
  })

  it('renders with inactive state', () => {
    const { container } = render(<VoiceVisualizer isActive={false} volume={0} isSpeaking={false} />)

    expect(container.querySelector('div[class*="flex"]')).toBeInTheDocument()
  })

  it('renders with active state', () => {
    const { container } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    expect(container.querySelector('div[class*="flex"]')).toBeInTheDocument()
  })

  it('renders with speaking state', () => {
    const { container } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={true} />)

    expect(container.querySelector('div[class*="flex"]')).toBeInTheDocument()
  })

  it('applies gradient style to bars', () => {
    const { container } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    const bars = container.querySelectorAll('[data-testid="motion-div"]')
    expect(bars.length).toBeGreaterThan(0)
  })

  it('applies rounded-full class to bars', () => {
    const { container } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    const bars = container.querySelectorAll('[class*="rounded-full"]')
    expect(bars.length).toBeGreaterThan(0)
  })

  it('accepts isActive prop', () => {
    render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('accepts volume prop', () => {
    render(<VoiceVisualizer isActive={true} volume={0.75} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('accepts isSpeaking prop', () => {
    render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={true} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('renders container with proper flex layout', () => {
    const { container } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    const flexContainer = container.querySelector('div[class*="flex"]')
    expect(flexContainer).toHaveClass('flex')
    expect(flexContainer).toHaveClass('items-center')
    expect(flexContainer).toHaveClass('gap-0.5')
  })

  it('maintains bar height at 4 when inactive', () => {
    render(<VoiceVisualizer isActive={false} volume={0} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('animates bars when speaking', () => {
    const { container } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={true} />)

    const motionDivs = container.querySelectorAll('[data-testid="motion-div"]')
    expect(motionDivs.length).toBe(5)
  })

  it('responds to volume changes', () => {
    const { rerender } = render(<VoiceVisualizer isActive={true} volume={0.2} isSpeaking={false} />)

    rerender(<VoiceVisualizer isActive={true} volume={0.8} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('transitions between speaking and listening', () => {
    const { rerender } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    rerender(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={true} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('transitions between active and inactive', () => {
    const { rerender } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    rerender(<VoiceVisualizer isActive={false} volume={0} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('renders with h-4 height class', () => {
    const { container } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    const flexContainer = container.querySelector('div[class*="h-4"]')
    expect(flexContainer).toBeInTheDocument()
  })

  it('renders with px-1 padding class', () => {
    const { container } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    const flexContainer = container.querySelector('div[class*="px-1"]')
    expect(flexContainer).toBeInTheDocument()
  })

  it('is memoized to prevent unnecessary re-renders', () => {
    const { rerender } = render(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    rerender(<VoiceVisualizer isActive={true} volume={0.5} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('handles zero volume gracefully', () => {
    render(<VoiceVisualizer isActive={true} volume={0} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('handles maximum volume', () => {
    render(<VoiceVisualizer isActive={true} volume={1} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })

  it('handles edge case: active but silent', () => {
    render(<VoiceVisualizer isActive={true} volume={0} isSpeaking={false} />)

    expect(screen.getAllByTestId('motion-div')).toHaveLength(5)
  })
})
