'use client'

/**
 * PwaInstallBanner — Prominent PWA install CTA for public pages (landing, login).
 *
 * Renders a full-width download button styled to match the Cronix landing palette.
 * Handles both Android/Chrome (beforeinstallprompt) and iOS (manual guide).
 * Returns null when the app is already installed or no prompt is available.
 */

import { useState } from 'react'
import { Download, Share, X, Smartphone } from 'lucide-react'
import { usePwaInstall } from '@/lib/hooks/use-pwa-install'

interface PwaInstallBannerProps {
  variant?: 'hero' | 'navbar'
}

export function PwaInstallBanner({ variant = 'hero' }: PwaInstallBannerProps) {
  const { canInstall, isIos, isInstalled, install } = usePwaInstall()
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [dismissed,    setDismissed]    = useState(false)

  if (dismissed) return null
  
  // En el modo navbar, queremos que sea visible para diseño incluso si canInstall es falso
  if (variant !== 'navbar' && isInstalled) return null
  if (variant !== 'navbar' && !canInstall && !isIos) return null

  const isNavbar = variant === 'navbar'

  // Styles based on variant
  const buttonStyles: React.CSSProperties = {
    display:         'inline-flex',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             isNavbar ? '8px' : '10px',
    padding:         isNavbar ? '9px 22px' : '14px 32px',
    borderRadius:    isNavbar ? '10px' : '14px',
    fontSize:        isNavbar ? '13px' : '15px',
    fontWeight:      700,
    color:           '#fff',
    textDecoration:  'none',
    background:      isNavbar 
      ? 'linear-gradient(135deg, #0062FF 0%, #0041AB 100%)' 
      : 'linear-gradient(135deg, #00C853 0%, #009624 100%)',
    boxShadow:       isNavbar
      ? '0 0 20px rgba(0,98,255,0.3)'
      : '0 0 30px rgba(0,200,83,0.35), 0 4px 20px rgba(0,200,83,0.25)',
    border:          'none',
    cursor:          'pointer',
    transition:      'transform 0.15s, box-shadow 0.15s',
    whiteSpace:      'nowrap',
  }

  // ── Android / Chrome ──────────────────────────────────────────────────────
  if (canInstall || variant === 'navbar') {
    return (
      <button
        onClick={canInstall ? install : () => {}}
        style={{
          ...buttonStyles,
          opacity: canInstall ? 1 : 0.9, // Sutil diferencia para desarrolladores
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.03)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        <Download size={isNavbar ? 16 : 18} />
        {isNavbar ? 'Descargar App' : 'Instalar app gratis'}
      </button>
    )
  }

  // ── iOS ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setShowIosGuide(v => !v)}
        style={buttonStyles}
      >
        <Smartphone size={isNavbar ? 16 : 18} />
        {isNavbar ? 'Instalar App' : 'Añadir a inicio'}
      </button>

      {showIosGuide && (
        <div
          style={{
            position:     'absolute',
            top:          isNavbar ? 'calc(100% + 12px)' : 'auto',
            bottom:       isNavbar ? 'auto' : 'calc(100% + 12px)',
            right:        isNavbar ? '0' : 'auto',
            left:         isNavbar ? 'auto' : '50%',
            transform:    isNavbar ? 'none' : 'translateX(-50%)',
            width:        '280px',
            padding:      '16px',
            borderRadius: '16px',
            background:   '#1C1C1F',
            border:       '1px solid rgba(255,255,255,0.1)',
            boxShadow:    '0 8px 40px rgba(0,0,0,0.5)',
            zIndex:       100,
            textAlign:    'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: '#F2F2F2', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Share size={14} style={{ color: '#4D83FF' }} />
              Instalar en iPhone/iPad
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
              <>Toca el ícono de compartir <strong style={{ color: '#4D83FF' }}>⬆</strong> en Safari</>,
              <>Desplázate y toca <strong style={{ color: '#F2F2F2' }}>&ldquo;Añadir a pantalla de inicio&rdquo;</strong></>,
              <>Toca <strong style={{ color: '#F2F2F2' }}>&ldquo;Añadir&rdquo;</strong> para confirmar</>,
            ].map((step, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#D1D1D6', lineHeight: 1.5 }}>
                <span style={{ color: isNavbar ? '#0062FF' : '#00C853', fontWeight: 800, flexShrink: 0 }}>{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <button
            onClick={() => setDismissed(true)}
            style={{
              marginTop:    '14px',
              width:        '100%',
              padding:      '8px',
              borderRadius: '10px',
              background:   'rgba(255,255,255,0.05)',
              border:       '1px solid rgba(255,255,255,0.08)',
              color:        '#909098',
              fontSize:     '12px',
              cursor:       'pointer',
              fontWeight:   600,
            }}
          >
            No mostrar de nuevo
          </button>
        </div>
      )}
    </div>
  )
}
