import { createClient } from '@/lib/supabase/server'

/**
 * Password Lockout Alert System
 * Sends alerts when a user is locked out 5+ times in 24 hours
 * Helps prevent brute-force attacks
 */

const ALERT_THRESHOLD = 5 // Number of lockouts to trigger alert
const ALERT_WINDOW_HOURS = 24 // Time window in hours

export interface LockoutAlert {
  email: string
  attempt_count: number
  lockout_count_24h: number
  should_alert: boolean
  alert_type: 'none' | 'warning' | 'critical' | 'immediate_review'
  recommended_action: string
}

/**
 * Check if a user should receive a lockout alert
 * Returns alert metadata for notification systems
 */
export async function checkLockoutAlert(email: string): Promise<LockoutAlert> {
  const supabase = await createClient()

  // Get current lockout info
  const { data: lockoutData } = await supabase
    .from('failed_password_attempts')
    .select('attempt_count, locked_until, created_at')
    .eq('email', email)
    .single()

  // Get lockout history from last 24 hours
  const oneDayAgo = new Date(Date.now() - ALERT_WINDOW_HOURS * 60 * 60 * 1000)

  const { data: recentLockouts, count: lockout_count_24h } = await supabase
    .from('failed_password_attempts')
    .select('id', { count: 'exact' })
    .eq('email', email)
    .gte('updated_at', oneDayAgo.toISOString())

  const attempt_count = lockoutData?.attempt_count || 0
  const total_lockouts = lockout_count_24h || 0

  // Determine alert level
  let alert_type: LockoutAlert['alert_type'] = 'none'
  let recommended_action = 'Monitor'

  if (total_lockouts >= 5 && total_lockouts < 10) {
    alert_type = 'warning'
    recommended_action = 'Send warning email to user; offer account recovery assistance'
  } else if (total_lockouts >= 10 && total_lockouts < 15) {
    alert_type = 'critical'
    recommended_action = 'Disable account temporarily; require email verification before unlock'
  } else if (total_lockouts >= 15) {
    alert_type = 'immediate_review'
    recommended_action = 'FLAG FOR SECURITY TEAM: Probable brute-force attack; review IP logs'
  }

  return {
    email,
    attempt_count,
    lockout_count_24h: total_lockouts,
    should_alert: total_lockouts >= ALERT_THRESHOLD,
    alert_type,
    recommended_action,
  }
}

/**
 * Send alert notification (email)
 */
export async function sendLockoutAlert(alert: LockoutAlert): Promise<boolean> {
  try {
    if (!alert.should_alert) return false

    const supabase = await createClient()

    // Create audit log entry
    await supabase.from('security_alerts').insert({
      alert_type: 'password_lockout_threshold',
      severity: alert.alert_type,
      user_email: alert.email,
      lockout_count_24h: alert.lockout_count_24h,
      recommended_action: alert.recommended_action,
      status: 'pending_review',
    })

    // TODO: Integrate with email service (SendGrid, Resend, etc.)
    // await sendEmail({
    //   to: ADMIN_EMAIL,
    //   subject: `Security Alert: ${alert.alert_type.toUpperCase()} - ${alert.email}`,
    //   template: 'password-lockout-alert',
    //   data: alert,
    // })

    // TODO: Send Slack notification to security team
    // await notifySlack({
    //   channel: '#security-alerts',
    //   message: formatSlackAlert(alert),
    // })

    console.log(`[SECURITY ALERT] ${alert.alert_type.toUpperCase()}: ${alert.email} (${alert.lockout_count_24h} lockouts/24h)`)

    return true
  } catch (error) {
    console.error('Failed to send lockout alert:', error)
    return false
  }
}

/**
 * Get all users with elevated lockout counts
 * Useful for security dashboard
 */
export async function getHighRiskUsers(threshold: number = 5): Promise<LockoutAlert[]> {
  const supabase = await createClient()

  const oneDayAgo = new Date(Date.now() - ALERT_WINDOW_HOURS * 60 * 60 * 1000)

  const { data: users } = await supabase
    .from('failed_password_attempts')
    .select('email, attempt_count, updated_at')
    .gte('updated_at', oneDayAgo.toISOString())

  if (!users) return []

  // Group by email and count
  const emailCounts = users.reduce(
    (acc, record) => {
      acc[record.email] = (acc[record.email] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  // Filter and map
  const alerts: LockoutAlert[] = []
  for (const [email, count] of Object.entries(emailCounts)) {
    if (count >= threshold) {
      const alert = await checkLockoutAlert(email)
      alerts.push(alert)
    }
  }

  return alerts.sort((a, b) => b.lockout_count_24h - a.lockout_count_24h)
}

/**
 * Format alert for Slack notification
 */
function formatSlackAlert(alert: LockoutAlert): string {
  return `
🚨 *Password Lockout Alert*
*Severity:* ${alert.alert_type.toUpperCase()}
*Email:* ${alert.email}
*Lockouts (24h):* ${alert.lockout_count_24h}
*Current Attempts:* ${alert.attempt_count}/3
*Action:* ${alert.recommended_action}
  `.trim()
}

/**
 * Format alert for email notification
 */
export function formatEmailAlert(alert: LockoutAlert): {
  subject: string
  body: string
} {
  const subject =
    alert.alert_type === 'immediate_review'
      ? `🚨 URGENT: Suspected Brute-Force Attack - ${alert.email}`
      : `Security Alert: Multiple Login Failures - ${alert.email}`

  const body = `
User: ${alert.email}
Alert Level: ${alert.alert_type.toUpperCase()}
Failed Login Attempts (24h): ${alert.lockout_count_24h}
Current Lock Status: ${alert.attempt_count}/3

Recommended Action:
${alert.recommended_action}

Dashboard: https://admin.cronix.app/security/alerts

Do not reply to this email. Contact security team if needed.
  `.trim()

  return { subject, body }
}
