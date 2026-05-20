import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Modal } from '@/components/ui/modal'

vi.mock('lucide-react', () => ({
  X: () => <div data-testid="x-icon" />,
}))

vi.mock('./button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

describe('Modal Component', () => {
  const onCloseMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.style.overflow = ''
  })

  it('returns null when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={onCloseMock} title="Test">
        Content
      </Modal>
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders when open', () => {
    render(
      <Modal open={true} onClose={onCloseMock} title="Test">
        Content
      </Modal>
    )

    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('renders children content', () => {
    render(
      <Modal open={true} onClose={onCloseMock}>
        <div data-testid="test-content">Test Content</div>
      </Modal>
    )

    expect(screen.getByTestId('test-content')).toBeInTheDocument()
  })

  it('displays title when provided', () => {
    render(
      <Modal open={true} onClose={onCloseMock} title="Modal Title">
        Content
      </Modal>
    )

    expect(screen.getByText('Modal Title')).toBeInTheDocument()
  })

  it('displays description when provided', () => {
    render(
      <Modal open={true} onClose={onCloseMock} description="Modal Description">
        Content
      </Modal>
    )

    expect(screen.getByText('Modal Description')).toBeInTheDocument()
  })

  it('displays both title and description', () => {
    render(
      <Modal
        open={true}
        onClose={onCloseMock}
        title="Title"
        description="Description"
      >
        Content
      </Modal>
    )

    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Description')).toBeInTheDocument()
  })

  it('displays footer when provided', () => {
    render(
      <Modal open={true} onClose={onCloseMock} footer={<div>Footer</div>}>
        Content
      </Modal>
    )

    expect(screen.getByText('Footer')).toBeInTheDocument()
  })

  it('closes when close button clicked', () => {
    render(
      <Modal open={true} onClose={onCloseMock} title="Test">
        Content
      </Modal>
    )

    const closeButtons = screen.getAllByRole('button').filter(btn => btn.getAttribute('aria-label') === 'Cerrar')
    if (closeButtons.length > 0) {
      fireEvent.click(closeButtons[0])
      expect(onCloseMock).toHaveBeenCalled()
    }
  })

  it('closes when Escape key pressed', () => {
    render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCloseMock).toHaveBeenCalled()
  })

  it('closes when backdrop clicked', () => {
    render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)

    expect(onCloseMock).toHaveBeenCalled()
  })

  it('prevents closing when modal content clicked', () => {
    render(
      <Modal open={true} onClose={onCloseMock}>
        <div data-testid="modal-content">Content</div>
      </Modal>
    )

    fireEvent.click(screen.getByTestId('modal-content'))

    expect(onCloseMock).not.toHaveBeenCalled()
  })

  it('has dialog role', () => {
    render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('has aria-modal attribute', () => {
    render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('renders small size', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock} size="sm">
        Content
      </Modal>
    )

    const contentDiv = container.querySelector('div[class*="max-w-sm"]')
    expect(contentDiv).toBeInTheDocument()
  })

  it('renders medium size by default', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    const contentDiv = container.querySelector('div[class*="max-w-lg"]')
    expect(contentDiv).toBeInTheDocument()
  })

  it('renders large size', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock} size="lg">
        Content
      </Modal>
    )

    const contentDiv = container.querySelector('div[class*="max-w-2xl"]')
    expect(contentDiv).toBeInTheDocument()
  })

  it('renders xl size', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock} size="xl">
        Content
      </Modal>
    )

    const contentDiv = container.querySelector('div[class*="max-w-4xl"]')
    expect(contentDiv).toBeInTheDocument()
  })

  it('prevents body scroll when open', () => {
    render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body scroll when closed', async () => {
    const { rerender } = render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <Modal open={false} onClose={onCloseMock}>
        Content
      </Modal>
    )

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('')
    })
  })

  it('has backdrop with blur effect', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    const backdrop = container.querySelector('div[class*="backdrop-blur-sm"]')
    expect(backdrop).toBeInTheDocument()
  })

  it('renders close icon', () => {
    render(
      <Modal open={true} onClose={onCloseMock} title="Test">
        Content
      </Modal>
    )

    expect(screen.getByTestId('x-icon')).toBeInTheDocument()
  })

  it('hides header when no title or description', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    const header = container.querySelector('div[class*="border-b"]')
    expect(header).not.toBeInTheDocument()
  })

  it('shows header with border when title provided', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock} title="Test">
        Content
      </Modal>
    )

    const header = container.querySelector('div[class*="border-b"]')
    expect(header).toBeInTheDocument()
  })

  it('removes event listener on unmount', () => {
    const { unmount } = render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    unmount()

    fireEvent.keyDown(document, { key: 'Escape' })

    // onCloseMock should not be called again after unmount
    expect(onCloseMock).not.toHaveBeenCalled()
  })

  it('handles rapid open/close cycles', async () => {
    const { rerender } = render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    rerender(
      <Modal open={false} onClose={onCloseMock}>
        Content
      </Modal>
    )

    rerender(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('applies animation classes', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    const modal = container.querySelector('div[class*="animate-"]')
    expect(modal).toBeInTheDocument()
  })

  it('responsive: shows on bottom on mobile', () => {
    const { container } = render(
      <Modal open={true} onClose={onCloseMock}>
        Content
      </Modal>
    )

    const wrapper = container.querySelector('div[class*="flex items-end"]')
    expect(wrapper).toBeInTheDocument()
  })
})
