'use client'

/**
 * PwaInstallBanner — Prominent PWA install CTA for public pages (landing, login).
 *
 * Renders a full-width download button styled to match the Cronix landing palette.
 * Handles both Android/Chrome (beforeinstallprompt) and iOS (manual guide).
 * Returns null when the app is already installed or no prompt is available.
 */

import { useState } from 'react'
import Image from 'next/image'
import { Download, Share, X, Smartphone, Monitor } from 'lucide-react'
import { usePwaInstall } from '@/lib/hooks/use-pwa-install'
import { useTranslations } from 'next-intl'

interface PwaInstallBannerProps {
  variant?: 'hero' | 'navbar'
}

export function PwaInstallBanner({ variant = 'hero' }: PwaInstallBannerProps) {
  const { canInstall, isIos, isInstalled, install } = usePwaInstall()
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [dismissed,    setDismissed]    = useState(false)
  const t = useTranslations('pwa')

  if (dismissed) return null
  
  // En el modo navbar, queremos que sea visible para diseño incluso si canInstall es falso
  if (variant !== 'navbar' && isInstalled) return null
  if (variant !== 'navbar' && !canInstall && !isIos) return null

  const isNavbar = variant === 'navbar'

  // ── RENDER NAVBAR VARIANT (Simple Button) ──────────────────────────────────
  if (isNavbar) {
    return (
      <button
        onClick={canInstall ? install : (isIos ? () => setShowIosGuide(v => !v) : () => {})}
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
    )
  }

  // ── RENDER HERO/LOGIN VARIANT (Smart App Card) ──────────────────────────────
  return (
    <div 
      style={{ 
        width: '100%',
        maxWidth: '440px',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '16px',
          borderRadius: '18px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(56,132,255,0.15)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          transition: 'border-color 0.3s ease',
        }}
      >
        {/* Official Logo Mark */}
        <div 
          style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '12px', 
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
            flexShrink: 0,
            boxShadow: '0 0 15px rgba(56,132,255,0.2)'
          }}
        >
          <Image 
            src="/cronix-logo.jpg" 
            alt="Cronix" 
            width={48} 
            height={48} 
            className="object-cover" 
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
            <h4 style={{ color: '#F2F2F2', fontSize: '14px', fontWeight: 800, margin: 0 }}>
              Cronix App
            </h4>
            <span style={{ 
              fontSize: '9px', 
              fontWeight: 700, 
              background: 'rgba(56,132,255,0.15)', 
              color: '#3884FF', 
              padding: '2px 6px', 
              borderRadius: '6px',
              letterSpacing: '0.02em'
            }}>
              {t('pwaTag')}
            </span>
          </div>
          <p style={{ color: '#909098', fontSize: '12px', margin: 0, lineHeight: 1.4 }}>
            {t('subtitle')}
          </p>
        </div>

        {/* Action Button */}
        <button
          onClick={() => {
            if (canInstall) {
              install();
            } else if (isIos) {
              setShowIosGuide(v => !v);
            } else if (isInstalled) {
              alert(t('installedAlert'));
            } else {
              alert(t('browserError'));
            }
          }}
          disabled={isInstalled && !isNavbar}
          style={{
            padding: '10px 18px',
            borderRadius: '12px',
            fontSize: '13px',
            fontWeight: 800,
            color: '#fff',
            background: isInstalled 
              ? 'rgba(56,132,255,0.1)' 
              : 'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)',
            border: isInstalled ? '1px solid rgba(56,132,255,0.3)' : 'none',
            cursor: isInstalled ? 'default' : 'pointer',
            boxShadow: isInstalled ? 'none' : '0 4px 12px rgba(56,132,255,0.3)',
            transition: 'all 0.2s ease',
            whiteSpace: 'nowrap',
            opacity: isInstalled ? 0.8 : 1,
          }}
          onMouseEnter={e => {
            if (!isInstalled) e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={e => {
            if (!isInstalled) e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          {isInstalled ? t('installed') : (canInstall ? t('install') : t('get'))}
        </button>
      </div>

      {/* iOS guide popup integration */}
      {showIosGuide && (
        <div
          style={{
            marginTop:    '8px',
            width:        '100%',
            padding:      '16px',
            borderRadius: '16px',
            background:   '#161619',
            border:       '1px solid rgba(56,132,255,0.2)',
            boxShadow:    '0 12px 40px rgba(0,0,0,0.5)',
            zIndex:       100,
            textAlign:    'left',
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
            {[
              t('iosStep1'),
              t('iosStep2'),
              t('iosStep3'),
            ].map((step, i) => (
              <li key={i} style={{ fontSize: '12px', color: '#D1D1D6', lineHeight: 1.5 }}>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
