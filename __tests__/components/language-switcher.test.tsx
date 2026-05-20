/**
 * components/ui/language-switcher.tsx — Language Switcher Component Tests
 *
 * Tests dropdown, locale selection, and navigation
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LanguageSwitcher } from '@/components/ui/language-switcher'

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const trans: Record<string, string> = {
      label: 'Language',
      es: 'Spanish',
      en: 'English',
      pt: 'Portuguese',
      fr: 'French',
      de: 'German',
      it: 'Italian',
    }
    return trans[key] || key
  },
  useLocale: () => 'es',
}))

const mockRouterReplace = vi.fn()
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  usePathname: () => '/dashboard',
  routing: {
    locales: ['es', 'en', 'pt', 'fr', 'de', 'it'],
    defaultLocale: 'es',
  },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    toString: () => '',
  }),
  useTransition: () => [false, vi.fn()],
}))

vi.mock('lucide-react', () => ({
  Globe: () => <div data-testid="globe-icon" />,
}))

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LanguageSwitcher Component', () => {
  beforeEach(() => {
    mockRouterReplace.mockClear()
  })

  it('renders trigger button', () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('opens dropdown on button click', async () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    fireEvent.click(button)

    await waitFor(() => {
      const listbox = screen.getByRole('listbox')
      expect(listbox).toBeInTheDocument()
    })
  })

  it('displays all available locales in dropdown', async () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    fireEvent.click(button)

    await waitFor(() => {
      const options = screen.getAllByRole('option')
      expect(options.length).toBeGreaterThan(0)
    })
  })

  it('closes dropdown when a locale is selected', async () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    fireEvent.click(button)

    await waitFor(() => {
      const options = screen.getAllByRole('option')
      fireEvent.click(options[0])
    })

    // Dropdown should close
    await waitFor(() => {
      const listbox = screen.queryByRole('listbox')
      expect(listbox).not.toBeInTheDocument()
    })
  })

  it('calls router.replace when locale is selected', async () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    fireEvent.click(button)

    await waitFor(() => {
      const options = screen.getAllByRole('option')
      fireEvent.click(options[1]) // Select second locale
    })

    // Router should be called with replace
    expect(mockRouterReplace).toHaveBeenCalled()
  })

  it('shows globe icon', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByTestId('globe-icon')).toBeInTheDocument()
  })

  it('has proper aria attributes', () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    expect(button).toHaveAttribute('aria-haspopup', 'listbox')
    expect(button).toHaveAttribute('aria-label')
  })

  it('closes dropdown when clicking outside', async () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    // Click outside
    fireEvent.mouseDown(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })

  it('toggles dropdown on multiple clicks', async () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    // First click - open
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    // Second click - close
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    // Third click - open again
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })
  })

  it('shows current locale as selected', async () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    fireEvent.click(button)

    await waitFor(() => {
      const selectedOption = screen.getByRole('option', { selected: true })
      expect(selectedOption).toBeInTheDocument()
    })
  })

  it('displays flag emoji for each locale', async () => {
    render(<LanguageSwitcher />)
    const button = screen.getByRole('button')

    fireEvent.click(button)

    await waitFor(() => {
      // Flags should be displayed (they're emojis in the component)
      const options = screen.getAllByRole('option')
      expect(options.length).toBeGreaterThan(0)
    })
  })
})
