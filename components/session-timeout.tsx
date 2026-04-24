'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSessionTimeout, type SessionWarningType } from './hooks/use-session-timeout'

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')} min` : `${s} seg`
}

interface WarningDialogProps {
  title: string
  description: string
  msLeft: number
  onKeep?: () => void
  onSignout: () => void
}

function WarningDialog({ title, description, msLeft, onKeep, onSignout }: WarningDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-4 animate-slide-up"
        style={{
          backgroundColor: '#1A1A1F',
          border:          '1px solid #272729',
          boxShadow:       '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div
          className="h-12 w-12 rounded-2xl flex items-center justify-center mx-auto text-2xl"
          style={{ backgroundColor: 'rgba(255,214,10,0.1)', border: '1px solid rgba(255,214,10,0.25)' }}
        >
          ⏱️
        </div>

        <div className="text-center space-y-1.5">
          <h2 className="text-base font-black" style={{ color: '#F2F2F2', letterSpacing: '-0.02em' }}>
            {title}
          </h2>
          <p className="text-sm" style={{ color: '#909098' }}>{description}</p>
        </div>

        <div
          className="text-center py-3 rounded-xl"
          style={{ backgroundColor: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.2)' }}
        >
          <span className="text-2xl font-black tabular-nums" style={{ color: '#FFD60A' }}>
            {formatCountdown(msLeft)}
          </span>
        </div>

        <div className={`grid gap-2 ${onKeep ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {onKeep && (
            <button
              onClick={onKeep}
              className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:brightness-110"
              style={{ backgroundColor: '#0062FF', color: '#fff' }}
            >
              Mantener sesión
            </button>
          )}
          <button
            onClick={onSignout}
            className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200"
            style={{
              backgroundColor: 'rgba(255,59,48,0.1)',
              color:           '#FF3B30',
              border:          '1px solid rgba(255,59,48,0.2)',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}

const DIALOG_CONFIG: Record<Exclude<SessionWarningType, null>, { titleKey: string; descKey: string; showKeep: boolean }> = {
  inactivity: { titleKey: 'stillThereTitle', descKey: 'stillThereDesc', showKeep: true },
  absolute:   { titleKey: 'expiringTitle',    descKey: 'expiringDesc',    showKeep: false },
}

/**
 * Invisible component mounted once in DashboardLayout.
 * Enforces inactivity timeout (30 min) and absolute timeout (12 h).
 */
export function SessionTimeout() {
  const t = useTranslations('sessionTimeout')
  const { warning, warningMsLeft, onKeepSession, onSignout } = useSessionTimeout()

  if (!warning) return null

  const config = DIALOG_CONFIG[warning]
  return (
    <WarningDialog
      title={t(config.titleKey)}
      description={t(config.descKey)}
      msLeft={warningMsLeft}
      onKeep={config.showKeep ? onKeepSession : undefined}
      onSignout={onSignout}
    />
  )
}
