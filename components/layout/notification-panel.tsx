'use client'

import React, { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, CheckCheck, Clock, Info, CheckCircle2, AlertCircle, XCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { DATE_FNS_LOCALE_MAP } from '@/lib/i18n/date-locale'
import type { Locale as DateFnsLocale } from 'date-fns'
import type { Locale } from '@/i18n/routing'

export interface InAppNotification {
  id: string
  title: string
  content: string
  type: 'info' | 'success' | 'warning' | 'error'
  is_read: boolean
  created_at: string
}

interface NotificationPanelProps {
  isOpen: boolean
  onClose: () => void
  notifications: InAppNotification[]
  onMarkAllRead: () => void
}

export function NotificationPanel({ isOpen, onClose, notifications, onMarkAllRead }: NotificationPanelProps) {
  const t = useTranslations('notifications')
  const locale = useLocale() as Locale
  const [dateFnsLocale, setDateFnsLocale] = useState<DateFnsLocale | undefined>(undefined)

  // Load date-fns locale asynchronously — locale is stable within a session
  useEffect(() => {
    DATE_FNS_LOCALE_MAP[locale]().then(setDateFnsLocale)
  }, [locale])

  const unreadCount = notifications.filter(n => !n.is_read).length
  const hasNotifications = notifications.length > 0

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 size={14} className="text-[#30D158]" />
      case 'warning': return <AlertCircle size={14} className="text-[#FFD60A]" />
      case 'error':   return <XCircle size={14} className="text-[#FF3B30]" />
      default:        return <Info size={14} className="text-[#0062FF]" />
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop for mobile to close when tapping outside */}
          <div
            className="fixed inset-0 z-40 lg:hidden"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-[380px] z-50 overflow-hidden rounded-2xl border border-[#2E2E33] shadow-2xl"
            style={{
              backgroundColor: '#1A1A1F',
              top: '100%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2E2E33] bg-[#212125]/50">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-[#F2F2F2]" />
                <h3 className="text-sm font-bold text-[#F2F2F2]">{t('title')}</h3>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-[#0062FF] text-[10px] font-black text-white">
                    {unreadCount}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={onMarkAllRead}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#0062FF] hover:text-[#4d83ff] transition-colors"
                >
                  <CheckCheck size={12} />
                  {t('markAllRead')}
                </button>
              )}
            </div>

            {/* Scrollable Area */}
            <div className="max-h-[450px] overflow-y-auto custom-scrollbar">
              {!hasNotifications ? (
                <div className="py-12 flex flex-col items-center justify-center text-center px-6">
                  <div className="h-12 w-12 rounded-full bg-[#212125] flex items-center justify-center mb-4 border border-[#2E2E33]">
                    <Bell size={20} className="text-[#909098] opacity-20" />
                  </div>
                  <p className="text-sm font-medium text-[#F2F2F2]">{t('empty')}</p>
                  <p className="text-xs text-[#909098] mt-1 italic">{t('emptyDesc')}</p>
                </div>
              ) : (
                <div className="divide-y divide-[#2E2E33]">
                  {notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`group p-4 transition-colors hover:bg-white/5 ${!notif.is_read ? 'bg-[#0062FF]/[0.03]' : ''}`}
                    >
                      <div className="flex gap-3">
                        <div className="mt-1 flex-shrink-0">
                          {getTypeIcon(notif.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-2 mb-0.5">
                            <p className={`text-sm font-bold truncate ${!notif.is_read ? 'text-[#F2F2F2]' : 'text-[#909098]'}`}>
                              {notif.title}
                            </p>
                            <div className="flex items-center gap-1 text-[10px] text-[#505058] flex-shrink-0 whitespace-nowrap">
                              <Clock size={10} />
                              {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: dateFnsLocale })}
                            </div>
                          </div>
                          <p className={`text-xs leading-relaxed ${!notif.is_read ? 'text-[#C0C0C8]' : 'text-[#707078]'}`}>
                            {notif.content}
                          </p>
                        </div>
                        {!notif.is_read && (
                          <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#0062FF] shadow-[0_0_8px_rgba(0,98,255,0.6)]" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {hasNotifications && (
              <div className="px-4 py-2 bg-[#212125]/30 border-t border-[#2E2E33] text-center">
                <button
                  className="text-[10px] font-bold text-[#909098] hover:text-[#F2F2F2] transition-colors"
                  onClick={onClose}
                >
                  {t('title')}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
