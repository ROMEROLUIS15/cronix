'use client'

/**
 * PwaInstallFloating — Fixed bottom install bar for mobile devices.
 *
 * Visible without any scrolling. Hidden on lg+ screens where the inline
 * PwaInstallBanner in the CTA section is sufficient.
 */

import { useState } from 'react'
import { Download, Smartphone, Share, X } from 'lucide-react'
import { usePwaInstall } from '@/lib/hooks/use-pwa-install'
import { useTranslations } from 'next-intl'

export function PwaInstallFloating() {
  const { canInstall, isIos, isInstalled, install } = usePwaInstall()
  const [dismissed, setDismissed]       = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)
  const t = useTranslations('pwa')

  if (isInstalled || dismissed) return null
  if (!canInstall && !isIos)   return null

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

        {/* Main action row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
          <button
            onClick={canInstall ? install : () => setShowIosGuide(v => !v)}
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
            {canInstall ? <Download size={18} /> : <Smartphone size={18} />}
            {canInstall ? t('installFree') : t('getAppIos')}
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
