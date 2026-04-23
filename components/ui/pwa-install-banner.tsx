'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Download, Share, X } from 'lucide-react'
import { usePwaInstall } from '@/lib/hooks/use-pwa-install'
import { useTranslations } from 'next-intl'

interface PwaInstallBannerProps {
  variant?: 'hero' | 'navbar'
}

// Detect device type for correct install instructions
function useDeviceType() {
  const [device, setDevice] = useState<'ios' | 'android' | 'desktop'>('desktop')
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase()
    if (/iphone|ipad|ipod/.test(ua)) setDevice('ios')
    else if (/android/.test(ua))       setDevice('android')
    else                                setDevice('desktop')
  }, [])
  return device
}

export function PwaInstallBanner({ variant = 'hero' }: PwaInstallBannerProps) {
  const { canInstall, isIos, isInstalled, install } = usePwaInstall()
  const device = useDeviceType()
  const [showGuide,    setShowGuide]    = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [dismissed,    setDismissed]    = useState(false)
  const t = useTranslations('pwa')

  if (dismissed)  return null
  if (isInstalled) return null

  // hero/login only renders if installable or mobile
  if (variant !== 'navbar' && !canInstall && !isIos) return null

  // ── Shared click handler ─────────────────────────────────────────────────────
  const handleInstallClick = async () => {
    if (canInstall) {
      await install()
    } else if (isIos || device === 'ios') {
      setShowIosGuide(v => !v)
    } else {
      // Android or desktop without the deferred event — show manual guide
      setShowGuide(v => !v)
    }
  }

  // ── Android manual install guide ─────────────────────────────────────────────
  const AndroidGuide = () => (
    <div
      style={{
        position:     'fixed',
        inset:        0,
        zIndex:       99999,
        display:      'flex',
        alignItems:   'flex-end',
        justifyContent: 'center',
        background:   'rgba(0,0,0,0.7)',
      }}
      onClick={() => setShowGuide(false)}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width:        '100%',
          maxWidth:     '480px',
          background:   '#161619',
          borderRadius: '20px 20px 0 0',
          padding:      '24px 24px 40px',
          boxShadow:    '0 -8px 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: '#3A3A3F', borderRadius: 4, margin: '0 auto 20px' }} />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
              <Image src="/cronix-logo.jpg" alt="Cronix" width={40} height={40} style={{ objectFit: 'cover' }} />
            </div>
            <div>
              <p style={{ color: '#F2F2F2', fontWeight: 800, fontSize: 15, margin: 0 }}>Instalar Cronix</p>
              <p style={{ color: '#909098', fontSize: 12, margin: 0 }}>Agrega la app a tu celular</p>
            </div>
          </div>
          <button onClick={() => setShowGuide(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} style={{ color: '#909098' }} />
          </button>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
          {[
            { num: '1', text: 'Toca el menú ⋮ (tres puntos) en la esquina superior derecha del navegador' },
            { num: '2', text: 'Busca la opción "Instalar aplicación" o "Agregar a pantalla de inicio"' },
            { num: '3', text: 'Confirma tocando "Instalar" en el cuadro que aparece' },
          ].map(s => (
            <div key={s.num} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: '#fff',
              }}>
                {s.num}
              </div>
              <p style={{ color: '#D1D1D6', fontSize: 14, lineHeight: 1.5, margin: '2px 0 0' }}>{s.text}</p>
            </div>
          ))}
        </div>

        <button
          onClick={() => setShowGuide(false)}
          style={{
            width: '100%', padding: '14px', borderRadius: 14,
            background: 'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)',
            color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 15,
          }}
        >
          ¡Entendido!
        </button>
      </div>
    </div>
  )

  // ── iOS manual install guide ─────────────────────────────────────────────────
  const IosGuidePopup = () => (
    <div
      style={{
        marginTop:    8,
        width:        '100%',
        padding:      '16px',
        borderRadius: '16px',
        background:   '#161619',
        border:       '1px solid rgba(56,132,255,0.2)',
        boxShadow:    '0 12px 40px rgba(0,0,0,0.5)',
        zIndex:       100,
        animation:    'fade-in 0.3s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontWeight: 700, fontSize: '13px', color: '#F2F2F2', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Share size={14} style={{ color: '#3884FF' }} />
          {t('iosGuideTitle')}
        </span>
        <button
          onClick={() => setShowIosGuide(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <X size={16} style={{ color: '#909098' }} />
        </button>
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {[t('iosStep1'), t('iosStep2'), t('iosStep3')].map((step, i) => (
          <li key={i} style={{ fontSize: '12px', color: '#D1D1D6', lineHeight: 1.5 }}>{step}</li>
        ))}
      </ol>
    </div>
  )

  // ── NAVBAR VARIANT ───────────────────────────────────────────────────────────
  if (variant === 'navbar') {
    return (
      <>
        <button
          onClick={handleInstallClick}
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            '8px',
            padding:        '9px 22px',
            borderRadius:   '10px',
            fontSize:       '13px',
            fontWeight:     700,
            color:          '#fff',
            background:     'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)',
            boxShadow:      '0 0 20px rgba(56,132,255,0.25)',
            border:         'none',
            cursor:         'pointer',
            transition:     'all 0.2s ease',
            whiteSpace:     'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.03)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <Download size={16} />
          {t('downloadApp')}
        </button>

        {showGuide    && <AndroidGuide />}
        {showIosGuide && (
          <div style={{ position: 'fixed', bottom: 24, left: 16, right: 16, zIndex: 99999 }}>
            <IosGuidePopup />
          </div>
        )}
      </>
    )
  }

  // ── HERO / LOGIN VARIANT ─────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', maxWidth: '440px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          gap:           '16px',
          padding:       '16px',
          borderRadius:  '18px',
          background:    'rgba(255,255,255,0.03)',
          border:        '1px solid rgba(56,132,255,0.15)',
          backdropFilter:'blur(12px)',
          boxShadow:     '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Logo */}
        <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
          <Image src="/cronix-logo.jpg" alt="Cronix" width={48} height={48} className="object-cover" />
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <h4 style={{ color: '#F2F2F2', fontSize: 14, fontWeight: 800, margin: 0 }}>Cronix App</h4>
            <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(56,132,255,0.15)', color: '#3884FF', padding: '2px 6px', borderRadius: 6 }}>
              {t('pwaTag')}
            </span>
          </div>
          <p style={{ color: '#909098', fontSize: 12, margin: 0, lineHeight: 1.4 }}>{t('subtitle')}</p>
        </div>

        {/* CTA button */}
        <button
          onClick={handleInstallClick}
          style={{
            padding:      '10px 18px',
            borderRadius: '12px',
            fontSize:     '13px',
            fontWeight:   800,
            color:        '#fff',
            background:   'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)',
            border:       'none',
            cursor:       'pointer',
            boxShadow:    '0 4px 12px rgba(56,132,255,0.3)',
            transition:   'all 0.2s ease',
            whiteSpace:   'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
        >
          {canInstall ? t('install') : t('get')}
        </button>
      </div>

      {showIosGuide && <IosGuidePopup />}
    </div>
  )
}
