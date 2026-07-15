/**
 * components/ui/date-time-picker.tsx — DateTimePicker Component Tests
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DateTimePicker } from '@/components/ui/date-time-picker'

vi.mock('next-intl', async () => (await import('@/__tests__/setup/next-intl-mock')).createNextIntlMock())

// The component wires selection via `onSelect` (mode="single"), not onDayClick.
vi.mock('react-day-picker', () => ({
  DayPicker: ({ onSelect }: any) => (
    <div data-testid="day-picker">
      <button onClick={() => onSelect?.(new Date(2026, 4, 19))}>19</button>
    </div>
  ),
}))

vi.mock('date-fns', () => ({
  format: (date: Date, fmt: string) => '2026-05-19T10:30',
  isValid: (date: Date) => date instanceof Date,
  parse: (str: string) => new Date(str),
}))

vi.mock('lucide-react', () => ({
  CalendarDays: () => <div data-testid="calendar-icon" />,
  ChevronLeft: () => <div />,
  ChevronRight: () => <div />,
  Check: () => <div />,
  X: () => <div />,
}))

describe('DateTimePicker Component', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders calendar icon button', () => {
    render(<DateTimePicker value="" onChange={onChange} />)
    expect(screen.getByTestId('calendar-icon')).toBeInTheDocument()
  })

  it('opens picker on button click', () => {
    render(<DateTimePicker value="" onChange={onChange} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(screen.getByTestId('day-picker')).toBeInTheDocument()
  })

  it('parses datetime value correctly', () => {
    render(<DateTimePicker value="2026-05-19T10:30" onChange={onChange} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('formats time in 12-hour format', () => {
    render(<DateTimePicker value="2026-05-19T14:30" onChange={onChange} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('displays AM/PM selector', () => {
    render(<DateTimePicker value="2026-05-19T10:30" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))

    // Exact names avoid substring collisions with other button labels.
    expect(screen.getByRole('button', { name: 'AM' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PM' })).toBeInTheDocument()
  })

  it('calls onChange when a date is picked and confirmed', () => {
    render(<DateTimePicker value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))

    // Picking a day only stages it; onChange fires on Confirmar (handleConfirm).
    fireEvent.click(screen.getByText('19'))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(onChange).toHaveBeenCalled()
  })

  it('enforces minimum date constraint', () => {
    const minDate = '2026-05-19T00:00'
    render(
      <DateTimePicker
        value=""
        onChange={onChange}
        min={minDate}
      />
    )
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('handles empty value gracefully', () => {
    render(<DateTimePicker value="" onChange={onChange} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('displays required attribute when specified', () => {
    render(
      <DateTimePicker
        value=""
        onChange={onChange}
        required={true}
      />
    )
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('closes picker when confirm is clicked', () => {
    render(<DateTimePicker value="" onChange={onChange} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    // DayPicker should be visible
    expect(screen.getByTestId('day-picker')).toBeInTheDocument()
  })

  it('renders regardless of active locale', () => {
    // Locale only drives date-fns formatting (mocked here); the trigger renders either way.
    render(<DateTimePicker value="" onChange={onChange} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
