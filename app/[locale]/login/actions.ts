// Re-export auth actions from their canonical location in lib/
// This file exists so relative imports from login/page.tsx continue to work.
export { login, signInWithGoogle, signUpWithGoogle, signout } from '@/lib/actions/auth'
export type { LoginResult } from '@/lib/actions/auth'
