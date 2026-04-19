'use client'

import { useState, useCallback } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'

interface UsePasskeyLoginReturn {
  loading: boolean
  error: string | null
  authenticate: () => Promise<void>
  startConditional: () => Promise<void>
  clearError: () => void
}

async function fetchOptions() {
  const res = await fetch('/api/passkey/authenticate/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Failed to get authentication options')
  }
  return res.json()
}

async function verifyAssertion(assertion: unknown): Promise<{ verified: boolean; token_hash: string }> {
  const res = await fetch('/api/passkey/authenticate/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: assertion }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Authentication failed')
  }
  return res.json()
}

function redirectWithSession(tokenHash: string) {
  window.location.href = `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=email&next=/dashboard`
}

export function usePasskeyLogin(): UsePasskeyLoginReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Passive background request — resolves when user picks a passkey from the
  // email field autofill suggestion (Conditional UI, iOS 16+ / Chrome / Safari).
  // Fails silently: AbortError means the user clicked the button instead.
  const startConditional = useCallback(async () => {
    try {
      const options   = await fetchOptions()
      const assertion = await startAuthentication({ optionsJSON: options, useBrowserAutofill: true })
      const result    = await verifyAssertion(assertion)
      if (result.token_hash) redirectWithSession(result.token_hash)
    } catch {
      // Silence: AbortError (user took modal path) or unsupported browser
    }
  }, [])

  // Explicit button flow — opens the OS modal immediately.
  // Starting this request makes the browser cancel any pending conditional one.
  const authenticate = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const options   = await fetchOptions()
      const assertion = await startAuthentication({ optionsJSON: options })
      const result    = await verifyAssertion(assertion)
      if (result.token_hash) redirectWithSession(result.token_hash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    authenticate,
    startConditional,
    clearError: useCallback(() => setError(null), []),
  }
}
