'use client'

/**
 * PWA Debug Component — Shows detailed PWA installation status
 * Only shown in development (check console for production info)
 */

import { useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

export function PwaDebug() {
  const [status, setStatus] = useState<Record<string, unknown>>({})
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const checkStatus = async () => {
      const manifest = document.querySelector('link[rel="manifest"]')
      const swRegistration = await navigator.serviceWorker?.getRegistration()
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      const hasDeferredEvent = !!(window as any).__pwaDeferred || !!(window as any).__pwaReady

      setStatus({
        'Manifest Link': !!manifest,
        'SW Registered': !!swRegistration,
        'SW Scope': swRegistration?.scope || 'none',
        'Standalone Mode': isStandalone,
        'Deferred Event Captured': hasDeferredEvent,
        'User Agent': navigator.userAgent,
        'beforeinstallprompt Support': 'onbeforeinstallprompt' in window,
      })
    }

    checkStatus()
  }, [])

  if (process.env.NODE_ENV === 'production') return null

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 99999,
      fontSize: '11px',
      fontFamily: 'monospace',
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          background: '#1a1a1f',
          color: '#fff',
          border: '1px solid #3884FF',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        PWA Debug
        <ChevronDown size={12} style={{ transform: isOpen ? 'rotate(180deg)' : '' }} />
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          right: 0,
          marginBottom: '8px',
          padding: '12px',
          background: '#0F0F12',
          border: '1px solid #3884FF',
          borderRadius: '8px',
          minWidth: '280px',
          maxHeight: '400px',
          overflow: 'auto',
        }}>
          {Object.entries(status).map(([key, value]) => (
            <div key={key} style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '6px',
              paddingBottom: '6px',
              borderBottom: '1px solid #272729',
              color: typeof value === 'boolean' ? (value ? '#30D158' : '#FF3B30') : '#909098',
            }}>
              <span>{key}:</span>
              <strong>{String(value)}</strong>
            </div>
          ))}
          <div style={{ marginTop: '12px', color: '#909098', fontSize: '10px' }}>
            Check browser console for detailed logs
          </div>
        </div>
      )}
    </div>
  )
}
