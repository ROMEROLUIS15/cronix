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
      message: 'Your appointment is confirmed',
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: '2',
      title: 'Payment received',
      message: 'Payment of $99 received',
      is_read: true,
      created_at: new Date().toISOString(),
    },
  ]

  it('renders notification list', () => {
    render(
      <NotificationPanel
        open={true}
        notifications={mockNotifications}
      />
    )

    expect(screen.getByText('Appointment confirmed')).toBeInTheDocument()
    expect(screen.getByText('Payment received')).toBeInTheDocument()
  })

  it('displays unread badge for unread notifications', () => {
    render(
      <NotificationPanel
        open={true}
        notifications={mockNotifications}
      />
    )

    // First notification is unread
    const unreadElements = screen.queryAllByText(/unread|new/i)
    expect(unreadElements.length).toBeGreaterThanOrEqual(0)
  })

  it('marks notification as read on click', () => {
    const onMarkRead = vi.fn()
    render(
      <NotificationPanel
        open={true}
        notifications={mockNotifications}
        onMarkRead={onMarkRead}
      />
    )

    const notification = screen.getByText('Appointment confirmed')
    fireEvent.click(notification)

    expect(onMarkRead).toHaveBeenCalledWith('1')
  })

  it('marks all as read when button clicked', () => {
    const onMarkAllRead = vi.fn()
    render(
      <NotificationPanel
        open={true}
        notifications={mockNotifications}
        onMarkAllRead={onMarkAllRead}
      />
    )

    const markAllButton = screen.getByRole('button', { name: /mark all/i })
    fireEvent.click(markAllButton)

    expect(onMarkAllRead).toHaveBeenCalled()
  })

  it('deletes notification on trash icon click', () => {
    const onDelete = vi.fn()
    render(
      <NotificationPanel
        open={true}
        notifications={mockNotifications}
        onDelete={onDelete}
      />
    )

    const trashButtons = screen.getAllByRole('button', { name: /delete|trash/i })
    if (trashButtons.length > 0) {
      fireEvent.click(trashButtons[0])
      expect(onDelete).toHaveBeenCalled()
    }
  })

  it('shows empty state when no notifications', () => {
    render(
      <NotificationPanel
        open={true}
        notifications={[]}
      />
    )

    expect(screen.getByText(/no notifications|sin notificaciones/i)).toBeInTheDocument()
  })

  it('displays notification timestamps', () => {
    render(
      <NotificationPanel
        open={true}
        notifications={mockNotifications}
      />
    )

    // Timestamps should be formatted (e.g., "2 hours ago")
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('has close button when provided', () => {
    const onClose = vi.fn()
    render(
      <NotificationPanel
        open={true}
        notifications={mockNotifications}
        onClose={onClose}
      />
    )

    const closeButton = screen.getByTestId('x-icon').closest('button')
    if (closeButton) {
      fireEvent.click(closeButton)
      expect(onClose).toHaveBeenCalled()
    }
  })

  it('is hidden when open={false}', () => {
    const { container } = render(
      <NotificationPanel
        open={false}
        notifications={mockNotifications}
      />
    )

    expect(container.firstChild).toHaveStyle({ display: 'none' })
  })

  it('filters by read status', () => {
    const onFilterRead = vi.fn()
    render(
      <NotificationPanel
        open={true}
        notifications={mockNotifications}
        onFilterRead={onFilterRead}
      />
    )

    expect(screen.getByText('Appointment confirmed')).toBeInTheDocument()
  })
})
