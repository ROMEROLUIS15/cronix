/**
 * components/ui/client-select.tsx — Client Select Component Tests
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ClientSelect } from '@/components/ui/client-select'

vi.mock('@/lib/hooks/use-clients-list', () => ({
  useClientsList: () => ({
    clients: [
      { id: '1', name: 'Client A' },
      { id: '2', name: 'Client B' },
    ],
    loading: false,
    error: null,
  }),
}))

describe('ClientSelect Component', () => {
  const mockClients = [
    { id: '1', name: 'Client A', phone: '1234567890', email: 'a@example.com', business_id: 'b1' },
    { id: '2', name: 'Client B', phone: '0987654321', email: 'b@example.com', business_id: 'b1' },
  ] as any[]

  it('renders select dropdown', () => {
    render(<ClientSelect clients={mockClients} value="" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /select client/i })).toBeInTheDocument()
  })

  it('displays client options when opened', async () => {
    render(<ClientSelect clients={mockClients} value="" onChange={() => {}} />)
    const button = screen.getByRole('button', { name: /select client/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Client A')).toBeInTheDocument()
      expect(screen.getByText('Client B')).toBeInTheDocument()
    })
  })

  it('calls onChange when client is selected', async () => {
    const onChange = vi.fn()
    render(<ClientSelect clients={mockClients} value="" onChange={onChange} />)

    const button = screen.getByRole('button', { name: /select client/i })
    fireEvent.click(button)

    await waitFor(() => {
      const option = screen.getByText('Client A')
      fireEvent.click(option)
      expect(onChange).toHaveBeenCalledWith('1')
    })
  })

  it('displays selected client name', () => {
    render(<ClientSelect clients={mockClients} value="1" onChange={() => {}} />)
    expect(screen.getByText('Client A')).toBeInTheDocument()
  })

  it('filters clients by search query', async () => {
    render(<ClientSelect clients={mockClients} value="" onChange={() => {}} />)
    const button = screen.getByRole('button', { name: /select client/i })
    fireEvent.click(button)

    const searchInput = screen.getByPlaceholderText(/search/i)
    fireEvent.change(searchInput, { target: { value: 'Client B' } })

    await waitFor(() => {
      expect(screen.getByText('Client B')).toBeInTheDocument()
    })
  })

  it('shows empty state when no clients match search', async () => {
    render(<ClientSelect clients={mockClients} value="" onChange={() => {}} />)
    const button = screen.getByRole('button', { name: /select client/i })
    fireEvent.click(button)

    const searchInput = screen.getByPlaceholderText(/search/i)
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })

    await waitFor(() => {
      expect(screen.getByText(/no clients found/i)).toBeInTheDocument()
    })
  })
})
