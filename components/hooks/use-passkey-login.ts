'use client'

import { useState, useCallback } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'

interface UsePasskeyLoginReturn {
  loading: boolean
  error: string | null
  authenticate: () => Promise<void>
  clearError: () => void
}

export function usePasskeyLogin(): UsePasskeyLoginReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const authenticate = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Step 1: Get authentication options from server
      const optionsRes = await fetch('/api/passkey/authenticate/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!optionsRes.ok) {
        const err = await optionsRes.json()
        throw new Error(err.error ?? 'Failed to get authentication options')
      }

      const options = await optionsRes.json()

      // Step 2: Use WebAuthn to authenticate
      const assertion = await startAuthentication(options)

      // Step 3: Verify the assertion with server
      const verifyRes = await fetch('/api/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      })

      if (!verifyRes.ok) {
        const err = await verifyRes.json()
        throw new Error(err.error ?? 'Authentication failed')
      }

      // Success — session is now active, page will redirect
      window.location.href = '/dashboard'
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
    clearError: useCallback(() => setError(null), []),
  }
}
