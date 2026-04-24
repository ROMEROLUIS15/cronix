export const DASHBOARD_AGENT_CONFIG = {
  /**
   * LLM tier used by LlmBridge → GroqProvider.
   * 'quality' maps to: primary llama-3.1-8b-instant, fallback llama-3.3-70b-versatile.
   * Change tier here if a faster/stronger model is needed for this agent.
   */
  llmTier: 'quality' as const,
  /**
   * Max ReAct loop iterations before forcing a fallback response.
   * Limits LLM + tool round-trips per user turn (latency guard).
   */
  maxReactIterations: 5,
} as const
