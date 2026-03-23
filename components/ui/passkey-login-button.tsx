'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Fingerprint, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type ButtonStatus = 'idle' | 'loading' | 'error'

export function PasskeyLoginButton() {
  const router   = useRouter()
  const supabase = createClient()

  const [supported, setSupported] = useState(false)
  const [status,    setStatus]    = useState<ButtonStatus>('idle')
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(ok => setSupported(ok))
        .catch(() => setSupported(false))
    }
  }, [])

  if (!supported) return null

  async function handleLogin() {
    setStatus('loading')
    setError(null)

    try {
      const { startAuthentication } = await import('@simplewebauthn/browser')

      // Get authentication options from server
      const optRes = await fetch('/api/passkey/authenticate/options', { method: 'POST' })
      if (!optRes.ok) throw new Error('Error al obtener opciones')
      const options = await optRes.json()

      // Trigger native biometric prompt
      const credential = await startAuthentication({ optionsJSON: options })

      // Verify with server — returns a Supabase session
      const verRes = await fetch('/api/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })
      if (!verRes.ok) {
        const err = await verRes.json()
        throw new Error(err.error || 'Error de verificación')
      }

      const { token_hash } = await verRes.json()

      // Exchange the one-time token for a full Supabase session
      const { error: otpError } = await supabase.auth.verifyOtp({
        token_hash,
        type: 'email',
      })
      if (otpError) throw otpError

      router.push('/dashboard')
      router.refresh()

    } catch (err: unknown) {
      const e = err as Error
      if (e.name === 'NotAllowedError') {
        // User cancelled — don't show error
        setStatus('idle')
        return
      }
      setError('No se pudo verificar la biometría. Usa tu contraseña.')
      setStatus('error')
    }
  }

  const isLoading = status === 'loading'

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-3 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-[0.98] hover:brightness-125 disabled:opacity-50"
        style={{
          padding:    '0.875rem',
          background: '#13131A',
          color:      '#D0D0DC',
          border:     '1px solid #22222E',
          cursor:     isLoading ? 'default' : 'pointer',
        }}
      >
        {isLoading ? (
          <>
            <Loader2 size={16} className="animate-spin" style={{ color: '#4D83FF' }} />
            Esperando biometría...
          </>
        ) : (
          <>
            <Fingerprint size={16} style={{ color: '#4D83FF' }} />
            Iniciar sesión con biometría
          </>
        )}
      </button>

      {status === 'error' && error && (
        <p className="text-center text-xs px-2" style={{ color: '#FF6B6B', lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  )
}
