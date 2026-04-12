export interface VoiceAssistantContext {
  businessId: string
  userId: string
  businessName: string
  userTimezone: string
  userRole: 'owner' | 'employee' | 'platform_admin'
  userName: string
  /** HTTP requestId from middleware — used for end-to-end tracing across Axiom and Sentry */
  requestId?: string
}
