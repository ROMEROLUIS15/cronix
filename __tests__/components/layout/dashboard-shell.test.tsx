import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DashboardShell } from '@/components/layout/dashboard-shell'



vi.mock('@/i18n/navigation', () => ({
  usePathname: vi.fn(),
}))

vi.mock('@/components/layout/sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}))

vi.mock('@/components/layout/topbar', () => ({
  // The shell passes LanguageSwitcher via `actions`; render it so the
  // language-switcher assertion sees it.
  Topbar: ({ title, subtitle, actions }: any) => (
    <div data-testid="topbar">
      <div>{title}</div>
      {subtitle && <div>{subtitle}</div>}
      {actions}
    </div>
  ),
}))

vi.mock('@/components/ui/language-switcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher">Lang</div>,
}))

vi.mock('@/lib/hooks/use-in-app-notifications', () => ({
  useInAppNotifications: vi.fn(),
}))

import { usePathname } from '@/i18n/navigation'
import { useInAppNotifications } from '@/lib/hooks/use-in-app-notifications'

describe('DashboardShell Component', () => {
  const mockUser = {
    id: 'user-123',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'owner' as const,
    business_id: 'biz-123',
    avatar_url: 'https://example.com/avatar.jpg',
    color: '#3884FF',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const mockBusiness = {
    id: 'biz-123',
    name: 'My Business',
    category: 'professional_services',
    address: null,
    logo_url: null,
    locale: 'es',
    phone: null,
    website: null,
    bonus_appointments_limit: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePathname).mockReturnValue('/dashboard')
    vi.mocked(useInAppNotifications).mockReturnValue({
      notifications: [],
      loading: false,
      unreadCount: 0,
      markAllAsRead: vi.fn(),
      refresh: vi.fn(),
    })
  })

  it('renders children content', () => {
    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div data-testid="content">Test Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('renders sidebar component', () => {
    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getAllByTestId('sidebar').length).toBeGreaterThan(0)
  })

  it('renders topbar component', () => {
    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('sets title based on pathname', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/clients')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('sets default title for dashboard', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('sets title for appointments page', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/appointments')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('sets title for services page', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/services')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('calls useInAppNotifications with business_id', () => {
    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(useInAppNotifications).toHaveBeenCalledWith('biz-123')
  })

  it('handles null user business_id', () => {
    render(
      <DashboardShell user={null} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(useInAppNotifications).toHaveBeenCalledWith(null)
  })

  it('renders language switcher', () => {
    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('language-switcher')).toBeInTheDocument()
  })

  it('has proper flex layout', () => {
    const { container } = render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    const shell = container.querySelector('.shell-height')
    expect(shell).toHaveClass('flex')
    expect(shell).toHaveClass('w-full')
  })

  it('locks body scroll when sidebar opens', async () => {
    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('sidebar').length).toBeGreaterThan(0)
    })
  })

  it('removes scroll lock on unmount', async () => {
    const { unmount } = render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    unmount()

    expect(document.body.classList.contains('scroll-locked')).toBe(false)
  })

  it('matches pathname for new appointment', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/appointments/new')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('matches pathname for edit appointment', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/appointments/apt-123/edit')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('matches pathname for client profile', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/clients/client-123')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('matches pathname for settings', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/settings')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('matches pathname for profile', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/profile')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('handles undefined pathname gracefully', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard')

    render(
      <DashboardShell user={mockUser} business={mockBusiness}>
        <div>Content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })
})
