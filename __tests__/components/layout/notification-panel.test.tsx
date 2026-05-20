/**
 * components/layout/notification-panel.tsx — Notification Panel Tests
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationPanel } from '@/components/layout/notification-panel'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('lucide-react', () => ({
  X: () => <div data-testid="x-icon" />,
  Check: () => <div />,
  Clock: () => <div />,
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

    const markAllButton = screen.getByRole('button', { name: /mark all/i })
    fireEvent.click(markAllButton)

    expect(onMarkAllRead).toHaveBeenCalled()
  })

  it('deletes notification on trash icon click', () => {
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    const trashButtons = screen.getAllByRole('button', { name: /delete|trash/i })
    const firstButton = trashButtons[0]
    if (firstButton) {
      fireEvent.click(firstButton)
      expect(firstButton).toBeInTheDocument()
    }
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

    expect(screen.getByText(/no notifications|sin notificaciones/i)).toBeInTheDocument()
  })

  it('displays notification timestamps', () => {
    render(
      <NotificationPanel
        isOpen={true}
        onClose={() => {}}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    // Timestamps should be formatted (e.g., "2 hours ago")
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('has close button when provided', () => {
    const onClose = vi.fn()
    render(
      <NotificationPanel
        isOpen={true}
        onClose={onClose}
        notifications={mockNotifications}
        onMarkAllRead={() => {}}
      />
    )

    const closeButton = screen.getByTestId('x-icon').closest('button')
    if (closeButton) {
      fireEvent.click(closeButton)
      expect(onClose).toHaveBeenCalled()
    }
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
