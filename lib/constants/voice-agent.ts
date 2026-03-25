/**
 * VoiceAgentConfig — placeholder interface for the future AI voice agent feature.
 *
 * This interface will be expanded when the voice agent integration is implemented.
 * Currently reserved to establish the type contract and module boundary.
 */

export interface VoiceAgentConfig {
  /** Unique identifier for the voice agent instance. */
  agentId:     string
  /** Human-readable name shown in the UI. */
  displayName: string
  /** Language/locale for speech recognition and synthesis (e.g. "es-CO"). */
  locale:      string
  /** Whether the voice agent is active for this business. */
  enabled:     boolean
}
