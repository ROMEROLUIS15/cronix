/**
 * Modal Component — Unit Tests (React Testing Library)
 *
 * Tests for components/ui/modal.tsx
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from '@/components/ui/modal'

describe('Modal Component', () => {
  it('renders children when open', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    )
    expect(screen.getByText(/modal content/i)).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    )
    expect(screen.queryByText(/modal content/i)).not.toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen onClose={onClose} title="Test Modal">
        <p>Content</p>
      </Modal>
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders title', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="My Custom Title">
        <p>Content</p>
      </Modal>
    )
    expect(screen.getByText(/my custom title/i)).toBeInTheDocument()
  })

  it('renders footer slot when provided', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Test" footer={<button>Save</button>}>
        <p>Content</p>
      </Modal>
    )
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('supports size variants', () => {
    const { rerender } = render(
      <Modal isOpen onClose={vi.fn()} title="Small" size="sm">
        <p>Small modal</p>
      </Modal>
    )
    expect(screen.getByText(/small modal/i)).toBeInTheDocument()

    rerender(
      <Modal isOpen onClose={vi.fn()} title="Large" size="lg">
        <p>Large modal</p>
      </Modal>
    )
    expect(screen.getByText(/large modal/i)).toBeInTheDocument()
  })
})
