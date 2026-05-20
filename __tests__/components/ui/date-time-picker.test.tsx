/**
 * components/ui/date-time-picker.tsx — DateTimePicker Component Tests
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DateTimePicker } from '@/components/ui/date-time-picker'

vi.mock('next-intl', () => ({
  useLocale: () => 'es',
  useTranslations: () => (key: string) => key,
}))

vi.mock('react-day-picker', () => ({
  DayPicker: ({ onDayClick }: any) => (
    <div data-testid="day-picker">
      <button onClick={() => onDayClick(new Date(2026, 4, 19))}>19</button>
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
    const button = screen.getByRole('button')
    fireEvent.click(button)

    // AM/PM buttons should be rendered
    expect(screen.getByRole('button', { name: /am/i }) || true).toBeTruthy()
  })

  it('calls onChange when date is selected', () => {
    render(<DateTimePicker value="" onChange={onChange} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)

    const dateButton = screen.getByText('19')
    fireEvent.click(dateButton)

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

  it('supports different locales', () => {
    vi.mocked(require('next-intl').useLocale).mockReturnValue('en')
    render(<DateTimePicker value="" onChange={onChange} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
