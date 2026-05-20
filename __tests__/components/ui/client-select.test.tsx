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
  it('renders select dropdown', () => {
    render(<ClientSelect value="" onChange={() => {}} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('displays client options', async () => {
    render(<ClientSelect value="" onChange={() => {}} />)
    const select = screen.getByRole('combobox')
    fireEvent.click(select)

    await waitFor(() => {
      expect(screen.getByText('Client A')).toBeInTheDocument()
      expect(screen.getByText('Client B')).toBeInTheDocument()
    })
  })

  it('calls onChange when client is selected', async () => {
    const onChange = vi.fn()
    render(<ClientSelect value="" onChange={onChange} />)

    const select = screen.getByRole('combobox')
    fireEvent.click(select)

    await waitFor(() => {
      const option = screen.getByText('Client A')
      fireEvent.click(option)
    })

    expect(onChange).toHaveBeenCalled()
  })

  it('displays selected value', () => {
    render(<ClientSelect value="1" onChange={() => {}} />)
    expect(screen.getByDisplayValue('Client A')).toBeInTheDocument()
  })

  it('handles loading state', () => {
    vi.mocked(require('@/lib/hooks/use-clients-list').useClientsList).mockReturnValue({
      clients: [],
      loading: true,
      error: null,
    })

    render(<ClientSelect value="" onChange={() => {}} />)
    expect(screen.getByText(/loading|cargando/i)).toBeInTheDocument()
  })

  it('shows empty option by default', () => {
    render(<ClientSelect value="" onChange={() => {}} />)
    const select = screen.getByRole('combobox')
    expect(select.querySelector('option:first-child')).toHaveValue('')
  })
})
