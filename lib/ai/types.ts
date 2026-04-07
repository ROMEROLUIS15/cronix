export interface VoiceAssistantContext {
  businessId: string
  userId: string
  businessName: string
  userTimezone: string
  userRole: 'owner' | 'employee' | 'platform_admin'
  userName: string
}
