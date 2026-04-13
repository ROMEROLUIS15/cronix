import { createAdminClient } from './db.ts'

export async function cleanupOldNotifications(): Promise<number> {
  const supabase = createAdminClient()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 30)

  const { error: cleanupErr, count: cleanedCount } = await supabase
    .from('notifications')
    .delete()
    .lt('created_at', cutoffDate.toISOString())
    .select('id', { count: 'exact' })

  if (cleanupErr) throw new Error(cleanupErr.message)
  return cleanedCount ?? 0
}
