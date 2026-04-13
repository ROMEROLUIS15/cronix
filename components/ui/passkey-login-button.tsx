'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Fingerprint, Loader2, Info, X } from 'lucide-react'
import { usePasskeyLogin } from '@/components/hooks/use-passkey-login'

const SETUP_STEPS = [
  'Inicia sesión con tu contraseña o Google',
  'Ve a tu Perfil (menú lateral, abajo a la izquierda)',
  'Toca "Registrar huella / Face ID"',
] as const

function SetupSheet({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl p-5 pb-8 space-y-4 animate-slide-up lg:hidden"
        style={{ background: '#13131A', border: '1px solid #22222E' }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold" style={{ color: '#4D83FF' }}>Cómo activar el login biométrico</p>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 transition-colors">
            <X size={16} style={{ color: '#909098' }} />
          </button>
        </div>
        <ol className="space-y-3">
          {SETUP_STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5"
                style={{ background: 'rgba(0,98,255,0.2)', color: '#4D83FF' }}>{i + 1}</span>
              <span className="text-sm" style={{ color: '#C0C0C8', lineHeight: 1.5 }}>{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="hidden lg:block rounded-xl p-3 space-y-2 animate-fade-in"
        style={{ background: 'rgba(0,98,255,0.06)', border: '1px solid rgba(0,98,255,0.12)' }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold" style={{ color: '#4D83FF' }}>Cómo activar el login biométrico:</p>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-white/5 transition-colors">
            <X size={13} style={{ color: '#909098' }} />
          </button>
        </div>
        <ol className="space-y-1.5">
          {SETUP_STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                style={{ background: 'rgba(0,98,255,0.2)', color: '#4D83FF' }}>{i + 1}</span>
              <span className="text-xs" style={{ color: '#C0C0C8', lineHeight: 1.5 }}>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

export function PasskeyLoginButton() {
  const router = useRouter()
  const { loading, error, authenticate, clearError } = usePasskeyLogin()
  const [supported, setSupported] = useState(false)
  const [noPasskey, setNoPasskey] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(ok => setSupported(ok))
        .catch(() => setSupported(false))
    }
  }, [])

  if (!supported) return null

  const handleLogin = async () => {
    setNoPasskey(false)
    clearError()
    try {
      await authenticate()
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setNoPasskey(true)
      }
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={handleLogin} disabled={loading}
        className="w-full flex items-center justify-center gap-3 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-[0.98] hover:brightness-125 disabled:opacity-50"
        style={{ padding: '0.875rem', background: '#13131A', color: '#D0D0DC', border: '1px solid #22222E', cursor: loading ? 'default' : 'pointer' }}>
        {loading ? (
          <><Loader2 size={16} className="animate-spin" style={{ color: '#4D83FF' }} /> Esperando biometría...</>
        ) : (
          <><Fingerprint size={16} style={{ color: '#4D83FF' }} /> Iniciar sesión con biometría</>
        )}
      </button>

      {error && (
        <p className="text-center text-xs px-2" style={{ color: '#FF6B6B', lineHeight: 1.5 }}>
          No se pudo verificar la biometría. Usa tu contraseña.
        </p>
      )}

      {noPasskey && (
        <div className="flex items-center justify-between gap-2 animate-fade-in">
          <p className="text-xs" style={{ color: '#909098', lineHeight: 1.5 }}>
            No tienes biometría configurada aquí.{' '}
            <button type="button" onClick={() => setShowGuide(true)}
              className="underline font-semibold transition-opacity hover:opacity-70" style={{ color: '#4D83FF' }}>
              ¿Cómo configurarla?
            </button>
          </p>
          <button type="button" onClick={() => setNoPasskey(false)}
            className="flex-shrink-0 p-1 rounded hover:bg-white/5 transition-colors">
            <X size={13} style={{ color: '#909098' }} />
          </button>
        </div>
      )}

      {!loading && !noPasskey && (
        <div className="text-center">
          <button type="button" onClick={() => setShowGuide(true)}
            className="inline-flex items-center gap-1 text-xs transition-opacity hover:opacity-80" style={{ color: '#4A4A5A' }}>
            <Info size={11} /> ¿Primera vez usando biometría?
          </button>
        </div>
      )}

      {showGuide && <SetupSheet onClose={() => setShowGuide(false)} />}
    </div>
  )
}
