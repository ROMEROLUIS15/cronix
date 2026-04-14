'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { useInAppNotifications } from '@/lib/hooks/use-in-app-notifications'
import { Tables } from '@/types/database.types'

// ── Types ──────────────────────────────────────────────────────────────────────
type UserProfile = Pick<
  Tables<'users'>,
  'name' | 'role' | 'business_id' | 'avatar_url' | 'color'
> | null

type BusinessProfile = Pick<Tables<'businesses'>, 'name' | 'category'> | null

interface DashboardShellProps {
  children: React.ReactNode
  user:     UserProfile
  business: BusinessProfile
}

// ── Page title map ─────────────────────────────────────────────────────────────
// Returns translation keys — resolved via t() inside the component.
// Match order matters: more specific patterns must come before broader ones.
type PageTitleEntry = {
  match:       (p: string) => boolean
  titleKey:    string
  subtitleKey: string
}

const PAGE_TITLE_ENTRIES: PageTitleEntry[] = [
  { match: p => p === '/dashboard',                   titleKey: 'dashboard',       subtitleKey: 'dashboardSub'      },
  { match: p => p.includes('/appointments/new'),      titleKey: 'newAppointment',  subtitleKey: 'agendaSub'         },
  { match: p => /\/appointments\/.+\/edit/.test(p),   titleKey: 'editAppointment', subtitleKey: 'agendaSub'         },
  { match: p => p.includes('/appointments'),          titleKey: 'appointments',    subtitleKey: 'appointmentsSub'   },
  { match: p => p.includes('/clients/new'),           titleKey: 'newClient',       subtitleKey: 'clientsSub'        },
  { match: p => /\/clients\/.+\/edit/.test(p),        titleKey: 'editClient',      subtitleKey: 'clientsSub'        },
  { match: p => /\/clients\/.+/.test(p),              titleKey: 'clientProfile',   subtitleKey: 'clientsSub'        },
  { match: p => p.includes('/clients'),               titleKey: 'clients',         subtitleKey: 'clientsSub'        },
  { match: p => p.includes('/services'),              titleKey: 'services',        subtitleKey: 'servicesSub'       },
  { match: p => p.includes('/settings'),              titleKey: 'settings',        subtitleKey: 'settingsSub'       },
  { match: p => p.includes('/profile'),               titleKey: 'myProfile',       subtitleKey: 'myProfileSub'      },
  { match: p => p.includes('/finances'),              titleKey: 'finances',        subtitleKey: 'financesSub'       },
  { match: p => p.includes('/reports'),               titleKey: 'reports',         subtitleKey: 'reportsSub'        },
  { match: p => p.includes('/dashboard/admin/pulse'), titleKey: 'dashboard',       subtitleKey: 'systemPulseSub'    },
  { match: p => p.includes('/setup'),                 titleKey: 'setup',           subtitleKey: 'setupSub'          },
]

// ── Component ──────────────────────────────────────────────────────────────────
export function DashboardShell({ children, user, business }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const t = useTranslations('pageTitles')
  const pathname = usePathname()

  const { notifications, markAllAsRead } = useInAppNotifications(user?.business_id ?? null)

  const pageEntry = PAGE_TITLE_ENTRIES.find(e => e.match(pathname ?? ''))
  const title    = pageEntry ? t(pageEntry.titleKey as Parameters<typeof t>[0])    : t('dashboard')
  const subtitle = pageEntry ? t(pageEntry.subtitleKey as Parameters<typeof t>[0]) : undefined

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add('scroll-locked')
    } else {
      document.body.classList.remove('scroll-locked')
    }
    return () => {
      document.body.classList.remove('scroll-locked')
    }
  }, [sidebarOpen])

  return (
    <div
      className="shell-height flex w-full overflow-hidden"
      style={{ backgroundColor: '#0F0F12' }}
    >

      {/* Sidebar — desktop */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar open={true} user={user} business={business} />
      </div>

      {/* Sidebar — mobile overlay */}
      <div className="lg:hidden">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={user}
          business={business}
        />
      </div>

      {/* Main column: fills remaining space, clips overflow except on main */}
      <div className="flex flex-1 flex-col min-w-0" style={{ overflow: 'hidden' }}>
        <Topbar
          title={title}
          subtitle={subtitle}
          onMenuClick={() => setSidebarOpen(prev => !prev)}
          notifications={notifications}
          onMarkAllRead={markAllAsRead}
          actions={<LanguageSwitcher />}
        />
        {/*
          SCROLL CONTRACT:
          overflow-y: scroll  — always-active; wheel events always reach this node.
          overscrollBehavior: contain — no bounce propagation without blocking wheel.
          min-height: 0  — mandatory on flex children; prevents flex blowout.
          All three are set via inline style (never Tailwind) to prevent any class
          purge or specificity issue from breaking scroll at runtime.
        */}
        <main
          id="main-scroll"
          className="flex-1 overflow-x-hidden"
          style={{
            overflowY: 'scroll',
            overscrollBehavior: 'contain',
            minHeight: 0,
            backgroundColor: '#0F0F12',
          }}
        >
          <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto w-full min-w-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
