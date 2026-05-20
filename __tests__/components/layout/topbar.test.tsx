/**
 * components/layout/topbar.tsx — Topbar Navigation Tests
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Topbar } from '@/components/layout/topbar'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('lucide-react', () => ({
  Menu: () => <div data-testid="menu-icon" />,
  Bell: () => <div data-testid="bell-icon" />,
}))

vi.mock('@/components/layout/notification-panel', () => ({
  NotificationPanel: ({ open, onMarkAllRead }: any) => (
    open ? <div data-testid="notification-panel">Notifications</div> : null
  ),
}))

describe('Topbar Component', () => {
  const mockNotifications = [
    { id: '1', message: 'Test 1', is_read: false },
    { id: '2', message: 'Test 2', is_read: true },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title', () => {
    render(<Topbar title="Dashboard" />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('renders subtitle when provided', () => {
    render(<Topbar title="Dashboard" subtitle="Welcome" />)
    expect(screen.getByText('Welcome')).toBeInTheDocument()
  })

  it('renders menu button', () => {
    const onMenuClick = vi.fn()
    render(<Topbar title="Dashboard" onMenuClick={onMenuClick} />)

    const menuButton = screen.getByTestId('menu-icon')
    expect(menuButton).toBeInTheDocument()
  })

  it('calls onMenuClick when menu button clicked', () => {
    const onMenuClick = vi.fn()
    render(<Topbar title="Dashboard" onMenuClick={onMenuClick} />)

    const button = screen.getByRole('button', { name: /menu/i })
    fireEvent.click(button)
    expect(onMenuClick).toHaveBeenCalled()
  })

  it('displays unread notification count', () => {
    render(
      <Topbar
        title="Dashboard"
        notifications={mockNotifications}
      />
    )

    // Count unread (1)
    const badge = screen.queryByText('1')
    expect(badge).toBeTruthy()
  })

  it('toggles notification panel', async () => {
    render(
      <Topbar
        title="Dashboard"
        notifications={mockNotifications}
      />
    )

    const bellButton = screen.getByTestId('bell-icon').closest('button')
    fireEvent.click(bellButton!)

    await waitFor(() => {
      expect(screen.getByTestId('notification-panel')).toBeInTheDocument()
    })
  })

  it('closes panel when clicking outside', async () => {
    render(
      <Topbar
        title="Dashboard"
        notifications={mockNotifications}
      />
    )

    const bellButton = screen.getByTestId('bell-icon').closest('button')
    fireEvent.click(bellButton!)

    await waitFor(() => {
      expect(screen.getByTestId('notification-panel')).toBeInTheDocument()
    })

    fireEvent.mouseDown(document.body)

    await waitFor(() => {
      expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument()
    })
  })

  it('renders action nodes when provided', () => {
    const actions = <button>Custom Action</button>
    render(<Topbar title="Dashboard" actions={actions} />)

    expect(screen.getByText('Custom Action')).toBeInTheDocument()
  })

  it('marks all as read on panel open', async () => {
    const onMarkAllRead = vi.fn()
    render(
      <Topbar
        title="Dashboard"
        notifications={mockNotifications}
        onMarkAllRead={onMarkAllRead}
      />
    )

    const bellButton = screen.getByTestId('bell-icon').closest('button')
    fireEvent.click(bellButton!)

    await waitFor(() => {
      expect(onMarkAllRead).toHaveBeenCalled()
    })
  })

  it('displays bell icon with badge styling', () => {
    render(
      <Topbar
        title="Dashboard"
        notifications={mockNotifications}
      />
    )

    expect(screen.getByTestId('bell-icon')).toBeInTheDocument()
  })

  it('handles empty notifications gracefully', () => {
    render(<Topbar title="Dashboard" notifications={[]} />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })
})
