'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'

interface VoiceVisualizerProps {
  isActive: boolean
  volume: number
  isSpeaking: boolean
}

/**
 * VoiceVisualizer — Animated audio level bars (Siri-style).
 *
 * Extracted as a stable, memoized component to prevent unnecessary re-creation
 * on every render of the parent VoiceAssistantFab.
 *
 * Performance notes:
 * - React.memo prevents re-rendering unless props change
 * - Spring animations run on the GPU via framer-motion's useTransform
 * - No state updates inside this component — all driven by parent props
 */
export const VoiceVisualizer = memo(function VoiceVisualizer({
  isActive,
  volume,
  isSpeaking,
}: VoiceVisualizerProps) {
  const bars = [0, 1, 2, 3, 4]

  return (
    <div className="flex items-center gap-0.5 h-4 px-1">
      {bars.map((i) => (
        <motion.div
          key={i}
          animate={{
            height: isActive
              ? isSpeaking
                ? [8, 16, 8] // Breathing rhythm
                : Math.max(4, volume * (1 + Math.sin(i * 45) * 0.5) * 20) // Dynamic reactive
              : 4
          }}
          transition={{
            type: 'spring',
            stiffness: 260,
            damping: 20,
            repeat: isSpeaking ? Infinity : 0,
            duration: isSpeaking ? 0.6 + i * 0.1 : 0
          }}
          className="w-1 rounded-full"
          style={{
            background: 'linear-gradient(to top, #3884FF, #A855F7, #EC4899)',
            boxShadow: '0 0 8px rgba(56,132,255,0.4)'
          }}
        />
      ))}
    </div>
  )
})
