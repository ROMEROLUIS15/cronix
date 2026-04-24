'use client'

/**
 * PwaInstallFloating — Fixed bottom install bar for mobile devices.
 *
 * Visible without any scrolling. Hidden on lg+ screens where the inline
 * PwaInstallBanner in the CTA section is sufficient.
 *
 * Shows for:
 *  - Android/Chrome with native beforeinstallprompt (one-tap install)
 *  - iOS Safari (manual Add to Home Screen guide)
 *  - Android without native prompt (browser-menu fallback instructions)
 */

import { useState } from 'react'
import { Download, Smartphone, Share, X } from 'lucide-react'
import { usePwaInstall } from '@/lib/hooks/use-pwa-install'
import { usePwaInstallFallback } from '@/lib/hooks/use-pwa-install-fallback'
import { useTranslations } from 'next-intl'

export function PwaInstallFloating() {
  const { canInstall, isIos, isInstalled, install } = usePwaInstall()
  const fallback = usePwaInstallFallback()
  const [dismissed,     setDismissed]     = useState(false)
  const [showIosGuide,  setShowIosGuide]  = useState(false)
  const [showFallback,  setShowFallback]  = useState(false)
  const t = useTranslations('pwa')

  if (isInstalled || dismissed) return null

  // Show for: native prompt, iOS, or Android-without-prompt (has manifest + SW)
  const hasAndroidFallback = !isIos && fallback.hasManifest && fallback.hasSW
  if (!canInstall && !isIos && !hasAndroidFallback) return null

  return (
    <div
      className="lg:hidden"
      style={{
        position:       'fixed',
        bottom:         0,
        left:           0,
        right:          0,
        zIndex:         9999,
        padding:        '10px 16px 24px',
        background:     'linear-gradient(to top, #0F0F12 70%, transparent)',
        pointerEvents:  'none',
      }}
    >
      <div style={{ pointerEvents: 'all', display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* iOS guide popup */}
        {showIosGuide && (
          <div
            style={{
              background:   '#1C1C1F',
              border:       '1px solid rgba(255,255,255,0.1)',
              borderRadius: '16px',
              padding:      '16px',
              boxShadow:    '0 -8px 40px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontWeight: 700, fontSize: '14px', color: '#F2F2F2', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Share size={14} style={{ color: '#4D83FF' }} />
                {t('iosGuideTitle')}
              </span>
              <button
                onClick={() => setShowIosGuide(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', lineHeight: 0 }}
              >
                <X size={16} style={{ color: '#909098' }} />
              </button>
            </div>

            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                t('iosStep1'),
                t('iosStep2'),
                t('iosStep3'),
              ].map((step, i) => (
                <li key={i} style={{ fontSize: '13px', color: '#D1D1D6', lineHeight: 1.5 }}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Android fallback sheet */}
        {showFallback && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 50000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end' }}
            onClick={() => setShowFallback(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', background: '#161619', borderRadius: '16px 16px 0 0', padding: '24px', boxShadow: '0 -4px 20px rgba(0,0,0,0.5)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, color: '#F2F2F2', fontSize: '16px', fontWeight: 700 }}>Instalar Cronix</h3>
                <button onClick={() => setShowFallback(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <X size={20} style={{ color: '#909098' }} />
                </button>
              </div>
              <p style={{ color: '#909098', marginBottom: '12px', fontSize: '14px', lineHeight: 1.6 }}>
                {fallback.instruction}
              </p>
              <div style={{ background: 'rgba(56,132,255,0.06)', border: '1px solid rgba(56,132,255,0.15)', borderRadius: '12px', padding: '12px', marginBottom: '20px' }}>
                <p style={{ color: '#D1D1D6', fontSize: '13px', margin: 0, lineHeight: 1.7 }}>
                  1. Toca el menú <strong style={{ color: '#F2F2F2' }}>⋮</strong> (tres puntos, arriba a la derecha)<br />
                  2. Selecciona <strong style={{ color: '#F2F2F2' }}>&ldquo;Instalar aplicación&rdquo;</strong> o <strong style={{ color: '#F2F2F2' }}>&ldquo;Añadir a pantalla de inicio&rdquo;</strong><br />
                  3. Confirma pulsando <strong style={{ color: '#F2F2F2' }}>&ldquo;Instalar&rdquo;</strong>
                </p>
              </div>
              <button onClick={() => setShowFallback(false)} style={{ width: '100%', padding: '14px', borderRadius: '12px', background: 'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}>
                Entendido
              </button>
            </div>
          </div>
        )}

        {/* Main action row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
          <button
            id="pwa-floating-install-btn"
            onClick={async () => {
              if (canInstall) {
                await install()
              } else if (isIos) {
                setShowIosGuide(v => !v)
              } else {
                setShowFallback(true)
              }
            }}
            style={{
              flex:            1,
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             '10px',
              padding:         '14px',
              borderRadius:    '14px',
              fontSize:        '15px',
              fontWeight:      700,
              color:           '#fff',
              background:      'linear-gradient(135deg, #3884FF 0%, #1A5FDB 100%)',
              boxShadow:       '0 0 24px rgba(56,132,255,0.3), 0 4px 16px rgba(0,0,0,0.4)',
              border:          'none',
              cursor:          'pointer',
            }}
          >
            {isIos ? <Smartphone size={18} /> : <Download size={18} />}
            {canInstall ? t('installFree') : isIos ? t('getAppIos') : t('installFree')}
          </button>

          <button
            onClick={() => setDismissed(true)}
            aria-label={t('close')}
            style={{
              width:        '48px',
              borderRadius: '14px',
              background:   '#1A1A1F',
              border:       '1px solid #272729',
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              flexShrink:   0,
            }}
          >
            <X size={16} style={{ color: '#909098' }} />
          </button>
        </div>
      </div>
    </div>
  )
}
