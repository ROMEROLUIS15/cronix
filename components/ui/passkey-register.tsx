'use client'

import { useState, useEffect, useCallback } from 'react'
import { Fingerprint, Trash2, Plus, AlertCircle, Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useTranslations } from 'next-intl'

interface StoredPasskey {
  id: string
  device_name: string | null
  created_at: string
}

export function PasskeyRegister() {
  const t = useTranslations('profile.passkeys')
  const [passkeys,    setPasskeys]    = useState<StoredPasskey[]>([])
  const [deviceName,  setDeviceName]  = useState('')
  const [loading,     setLoading]     = useState(true)
  const [registering, setRegistering] = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [success,     setSuccess]     = useState<string | null>(null)
  const [supported,   setSupported]   = useState(true)

  const supabase = createClient()

  const loadPasskeys = useCallback(async () => {
    const { data } = await supabase
      .from('user_passkeys')
      .select('id, device_name, created_at')
      .order('created_at', { ascending: false })
    setPasskeys(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSupported(!!window.PublicKeyCredential)
    }
    loadPasskeys()
  }, [loadPasskeys])

  if (!supported) {
    return (
      <div className="flex items-start gap-3 rounded-xl p-4"
        style={{ background: 'rgba(255,59,48,0.06)', border: '1px solid rgba(255,59,48,0.15)' }}>
        <AlertCircle size={18} style={{ color: '#FF3B30', flexShrink: 0, marginTop: 2 }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#F2F2F2' }}>
            {t('notAvailTitle')}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#909098' }}>
            {t('notAvailSub')}
          </p>
        </div>
      </div>
    )
  }

  const handleRegister = async () => {
    setError(null)
    setSuccess(null)
    setRegistering(true)

    try {
      const { startRegistration } = await import('@simplewebauthn/browser')

      const optRes = await fetch('/api/passkey/register/options', { method: 'POST' })
      if (!optRes.ok) throw new Error(t('registerErrorOptions'))
      const options = await optRes.json()

      const credential = await startRegistration({ optionsJSON: options })

      const verRes = await fetch('/api/passkey/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, deviceName: deviceName || t('defaultDevice') }),
      })
      if (!verRes.ok) {
        const err = await verRes.json()
        throw new Error(err.error || t('registerErrorVerify'))
      }

      setSuccess(t('registerSuccess'))
      setDeviceName('')
      loadPasskeys()
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError(t('registerCancel'))
        } else {
          setError(err.message || t('registerGeneric'))
        }
      } else {
        setError(t('registerGeneric'))
      }
    } finally {
      setRegistering(false)
    }
  }

  const handleDelete = async (id: string) => {
    const { error: deleteError } = await supabase.from('user_passkeys').delete().eq('id', id)
    if (deleteError) {
      setError(t('deleteError'))
      return
    }
    loadPasskeys()
  }

  return (
    <div className="space-y-4">

      <div className="flex items-center gap-2.5">
        <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(0,98,255,0.12)', border: '1px solid rgba(0,98,255,0.2)' }}>
          <Fingerprint size={18} style={{ color: '#4D83FF' }} />
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: '#F2F2F2' }}>
            {t('title')}
          </p>
          <p className="text-xs" style={{ color: '#909098' }}>
            {t('sub')}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl p-3"
          style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)' }}>
          <AlertCircle size={15} style={{ color: '#FF6B6B', flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs font-medium" style={{ color: '#FF6B6B' }}>{error}</p>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-xl text-xs font-medium"
          style={{ background: 'rgba(48,209,88,0.08)', border: '1px solid rgba(48,209,88,0.2)', color: '#30D158' }}>
          {success}
        </div>
      )}

      {/* Passkeys list */}
      {loading ? (
        <div className="flex justify-center py-2">
          <div className="animate-spin h-5 w-5 border-2 rounded-full"
            style={{ borderColor: '#0062FF', borderTopColor: 'transparent' }} />
        </div>
      ) : passkeys.length > 0 && (
        <div className="space-y-2">
          {passkeys.map(pk => (
            <div key={pk.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(0,98,255,0.05)', border: '1px solid rgba(0,98,255,0.12)' }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <Fingerprint size={16} style={{ color: '#4D83FF', flexShrink: 0 }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#F2F2F2' }}>
                    {pk.device_name || t('defaultDevice')}
                  </p>
                  <p className="text-xs" style={{ color: '#909098' }}>
                    {new Date(pk.created_at).toLocaleDateString('es', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
              <button onClick={() => handleDelete(pk.id)}
                className="flex-shrink-0 p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                aria-label="Eliminar">
                <Trash2 size={14} style={{ color: '#FF3B30' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Empty state — primer passkey */}
      {!loading && passkeys.length === 0 && (
        <div
          className="rounded-xl p-4 space-y-2 animate-fade-in"
          style={{ background: 'rgba(0,98,255,0.06)', border: '1px solid rgba(0,98,255,0.18)' }}
        >
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: '#4D83FF', flexShrink: 0 }} />
            <p className="text-xs font-bold" style={{ color: '#4D83FF' }}>
              {t('emptyTitle')}
            </p>
          </div>
          <p className="text-xs" style={{ color: '#909098', lineHeight: 1.6 }}>
            {t('emptySub')}
          </p>
        </div>
      )}

      {/* Register new */}
      <div className="space-y-2">
        <input
          type="text"
          value={deviceName}
          onChange={e => setDeviceName(e.target.value)}
          placeholder={t('inputPlaceholder')}
          maxLength={40}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: '#13131A', border: '1px solid #22222E', color: '#F2F2F2' }}
          onKeyDown={e => { if (e.key === 'Enter') handleRegister() }}
        />
        <button
          onClick={handleRegister}
          disabled={registering}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          style={{
            background: registering
              ? 'rgba(0,98,255,0.3)'
              : 'linear-gradient(135deg, #0062FF 0%, #0041AB 100%)',
            color: '#fff',
            boxShadow: registering ? 'none' : '0 0 20px rgba(0,98,255,0.25)',
          }}
        >
          <Plus size={15} />
          {registering ? t('btnWaiting') : passkeys.length > 0 ? t('btnAnother') : t('btnRegister')}
        </button>
      </div>

    </div>
  )
}
