/**
 * Re-export supabase client for shared imports.
 * Edge Functions should import from their own database.ts for isolation,
 * but this allows shared utilities like TenantGuard to access the client.
 */

export { getAdminClient, logToDLQ } from "./supabase.ts"
export { TenantGuard } from "./tenant-guard.ts"
