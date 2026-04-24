'use client'

/**
 * PwaInstallBanner — Prominent PWA install CTA for public pages (landing, login).
 *
 * Renders a full-width download button styled to match the Cronix landing palette.
 * Handles both Android/Chrome (beforeinstallprompt) and iOS (manual guide).
 * Returns null when the app is already installed.
 *
 * Variant "navbar": Compact button, always visible in the top nav (non-iOS too),
 *   so the user always has a path to install. Shows native prompt when available,
 *   otherwise shows the manual-instruction fallback sheet.
 *
 * Variant "hero": App Card in the hero section. Same logic, larger presentation.
 */

import { useState } from 'react'
import Image from 'next/image'
import { Download, Share, X } from 'lucide-react'
import { usePwaInstall } from '@/lib/hooks/use-pwa-install'
import { usePwaInstallFallback } from '@/lib/hooks/use-pwa-install-fallback'
import { useTranslations } from 'next-intl'

interface PwaInstallBannerProps {
  variant?: 'hero' | 'navbar'
}

export function PwaInstallBanner({ variant = 'hero' }: PwaInstallBannerProps) {
  const { canInstall, isIos, isInstalled, install } = usePwaInstall()
  const fallback = usePwaInstallFallback()
  const [showIosGuide,  setShowIosGuide]  = useState(false)
  const [showFallback,  setShowFallback]  = useState(false)
  const [dismissed,     setDismissed]     = useState(false)
  const t = useTranslations('pwa')

  // Always hide once the app is installed
  if (isInstalled || dismissed) return null

  const isNavbar = variant === 'navbar'

  // Hero variant: only show when there is a real install path available
  // (native prompt, iOS manual, or Android browser-menu fallback)
  const hasInstallPath = canInstall || isIos || (!fallback.isIos && fallback.hasManifest && fallback.hasSW)
  if (!isNavbar && !hasInstallPath) return null

  // ── Unified click handler ──────────────────────────────────────────────────
  const handleInstallClick = async () => {
    if (canInstall) {
      // Native one-tap install (Chrome/Android with real beforeinstallprompt)
      await install()
    } else if (isIos) {
      // iOS: show manual guide (Share → Add to Home Screen)
      setShowIosGuide(v => !v)
    } else {
      // Android without native prompt, or other browser:
      // Show manual instructions sheet (Chrome menu → Install app)
      setShowFallback(true)
    }
  }

  // ── NAVBAR VARIANT ─────────────────────────────────────────────────────────
  if (isNavbar) {
    return (
      <>
        <button
          id="pwa-navbar-install-btn"
          onClick={handleInstallClick}
          style={{
            display:         'inline-flex',
            alignItems:      'center',
            justifyContent:  'center',
            gap:             '8px',
            padding:         '9px 22px',
            borderRadius:    '10px',
            fontSize:        '13px',
            fontWeight:      700,
            color:           '#fff',
            background:      'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)',
            boxShadow:       '0 0 20px rgba(56,132,255,0.25)',
            border:          'none',
            cursor:          'pointer',
            transition:      'all 0.2s ease',
            whiteSpace:      'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.03)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <Download size={16} />
          {t('downloadApp')}
        </button>

        {/* iOS guide — inline below button */}
        {showIosGuide && (
          <div style={{
            position:     'absolute',
            top:          '60px',
            right:        '16px',
            zIndex:       10000,
            width:        '260px',
            padding:      '16px',
            borderRadius: '16px',
            background:   '#161619',
            border:       '1px solid rgba(56,132,255,0.2)',
            boxShadow:    '0 12px 40px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontWeight: 700, fontSize: '13px', color: '#F2F2F2', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Share size={14} style={{ color: '#3884FF' }} />
                {t('iosGuideTitle')}
              </span>
              <button onClick={() => setShowIosGuide(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <X size={16} style={{ color: '#909098' }} />
              </button>
            </div>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[t('iosStep1'), t('iosStep2'), t('iosStep3')].map((step, i) => (
                <li key={i} style={{ fontSize: '12px', color: '#D1D1D6', lineHeight: 1.5 }}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Android/other fallback instructions sheet */}
        {showFallback && (
          <FallbackSheet
            instruction={fallback.instruction}
            onClose={() => setShowFallback(false)}
          />
        )}
      </>
    )
  }

  // ── HERO VARIANT (App Card) ────────────────────────────────────────────────
  return (
    <div
      style={{
        width:         '100%',
        maxWidth:      '440px',
        position:      'relative',
        display:       'flex',
        flexDirection: 'column',
        gap:           '10px',
      }}
    >
      <div
        style={{
          display:          'flex',
          alignItems:       'center',
          gap:              '16px',
          padding:          '16px',
          borderRadius:     '18px',
          background:       'rgba(255,255,255,0.03)',
          border:           '1px solid rgba(56,132,255,0.15)',
          backdropFilter:   'blur(12px)',
          boxShadow:        '0 8px 32px rgba(0,0,0,0.2)',
          transition:       'border-color 0.3s ease',
        }}
      >
        {/* Logo */}
        <div style={{ width: '48px', height: '48px', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0, boxShadow: '0 0 15px rgba(56,132,255,0.2)' }}>
          <Image src="/cronix-logo.jpg" alt="Cronix" width={48} height={48} className="object-cover" />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
            <h4 style={{ color: '#F2F2F2', fontSize: '14px', fontWeight: 800, margin: 0 }}>
              Cronix App
            </h4>
            <span style={{ fontSize: '9px', fontWeight: 700, background: 'rgba(56,132,255,0.15)', color: '#3884FF', padding: '2px 6px', borderRadius: '6px', letterSpacing: '0.02em' }}>
              {t('pwaTag')}
            </span>
          </div>
          <p style={{ color: '#909098', fontSize: '12px', margin: 0, lineHeight: 1.4 }}>
            {t('subtitle')}
          </p>
        </div>

        {/* Action Button */}
        <button
          id="pwa-hero-install-btn"
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

      {/* iOS guide */}
      {showIosGuide && (
        <div style={{ marginTop: '8px', width: '100%', padding: '16px', borderRadius: '16px', background: '#161619', border: '1px solid rgba(56,132,255,0.2)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: 100, textAlign: 'left', animation: 'fade-in 0.3s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontWeight: 700, fontSize: '13px', color: '#F2F2F2', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Share size={14} style={{ color: '#3884FF' }} />
              {t('iosGuideTitle')}
            </span>
            <button onClick={() => setShowIosGuide(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <X size={16} style={{ color: '#909098' }} />
            </button>
          </div>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[t('iosStep1'), t('iosStep2'), t('iosStep3')].map((step, i) => (
              <li key={i} style={{ fontSize: '12px', color: '#D1D1D6', lineHeight: 1.5 }}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Android fallback sheet */}
      {showFallback && (
        <FallbackSheet
          instruction={fallback.instruction}
          onClose={() => setShowFallback(false)}
        />
      )}
    </div>
  )
}

// ── Shared Fallback Instructions Sheet ────────────────────────────────────────

function FallbackSheet({ instruction, onClose }: { instruction: string; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: '500px', margin: '0 auto', background: '#161619', borderRadius: '16px 16px 0 0', padding: '24px', boxShadow: '0 -4px 20px rgba(0,0,0,0.5)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, color: '#F2F2F2', fontSize: '16px', fontWeight: 700 }}>
            Instalar Cronix
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <X size={20} style={{ color: '#909098' }} />
          </button>
        </div>

        <p style={{ color: '#909098', marginBottom: '12px', fontSize: '14px', lineHeight: 1.6 }}>
          {instruction}
        </p>

        {/* Visual step guide for Android Chrome */}
        <div style={{ background: 'rgba(56,132,255,0.06)', border: '1px solid rgba(56,132,255,0.15)', borderRadius: '12px', padding: '12px', marginBottom: '20px' }}>
          <p style={{ color: '#D1D1D6', fontSize: '13px', margin: 0, lineHeight: 1.7 }}>
            1. Toca el menú <strong style={{ color: '#F2F2F2' }}>⋮</strong> (tres puntos, arriba a la derecha)<br />
            2. Selecciona <strong style={{ color: '#F2F2F2' }}>&quot;Instalar aplicación&quot;</strong> o <strong style={{ color: '#F2F2F2' }}>&quot;Añadir a pantalla de inicio&quot;</strong><br />
            3. Confirma pulsando <strong style={{ color: '#F2F2F2' }}>&quot;Instalar&quot;</strong>
          </p>
        </div>

        <button
          onClick={onClose}
          style={{ width: '100%', padding: '14px', borderRadius: '12px', background: 'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}
        >
          Entendido
        </button>
      </div>
    </div>
  )
}
