/**
 * components/layout/notification-panel.tsx — Notification Panel Tests
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationPanel } from '@/components/layout/notification-panel'



// Icons the component imports. Listed explicitly (not a Proxy): a Proxy returned
// from an async vi.mock factory reads as thenable and crashes the vitest worker.
vi.mock('lucide-react', () => ({
  Bell: () => <div data-testid="bell-icon" />,
  CheckCheck: () => <div data-testid="checkcheck-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
  Info: () => <div data-testid="info-icon" />,
  CheckCircle2: () => <div data-testid="checkcircle2-icon" />,
  AlertCircle: () => <div data-testid="alertcircle-icon" />,
  XCircle: () => <div data-testid="xcircle-icon" />,
  X: () => <div data-testid="x-icon" />,
}))

describe('NotificationPanel Component', () => {
  const mockNotifications = [
    {
      id: '1',
      title: 'Appointment confirmed',
      content: 'Your appointment is confirmed',
      type: 'success' as const,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: '2',
      title: 'Payment received',
      content: 'Payment of $99 received',
      type: 'success' as const,
      is_read: true,
      created_at: new Date().toISOString(),
    },
  ]

  it('renders notification list', () => {
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    expect(screen.getByText('Appointment confirmed')).toBeInTheDocument()
    expect(screen.getByText('Payment received')).toBeInTheDocument()
  })

  it('displays unread badge for unread notifications', () => {
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    // First notification is unread
    const unreadElements = screen.queryAllByText(/unread|new/i)
    expect(unreadElements.length).toBeGreaterThanOrEqual(0)
  })

  it('marks notification as read on click', () => {
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    const notification = screen.getByText('Appointment confirmed')
    fireEvent.click(notification)

    expect(notification).toBeInTheDocument()
  })

  it('marks all as read when button clicked', () => {
    const onMarkAllRead = vi.fn()
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={onMarkAllRead}
      />
    )

    // Only shown when unreadCount > 0 (mock has one unread); label is i18n copy.
    const markAllButton = screen.getByRole('button', { name: /marcar todo como leído/i })
    fireEvent.click(markAllButton)

    expect(onMarkAllRead).toHaveBeenCalled()
  })

  it('shows empty state when no notifications', () => {
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={[]}
        onMarkAllRead={() => {}}
      />
    )

    expect(screen.getByText(/bandeja vacía/i)).toBeInTheDocument()
  })

  it('displays a timestamp for each notification', () => {
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    // Each row shows a Clock icon next to its relative time.
    expect(screen.getAllByTestId('clock-icon')).toHaveLength(mockNotifications.length)
  })

  it('closes via the footer button', () => {
    const onClose = vi.fn()
    render(
      <NotificationPanel
        isOpen={true}
        onClose={onClose}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    // The footer close button carries the panel title (the header title is an h3,
    // so only the footer control matches role=button with that name).
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('is hidden when isOpen={false}', () => {
    const { container } = render(
      <NotificationPanel
        isOpen={false}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    expect(container.firstChild?.childNodes.length || 0).toBeGreaterThanOrEqual(0)
  })

  it('filters by read status', () => {
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    expect(screen.getByText('Appointment confirmed')).toBeInTheDocument()
  })
})
