import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import { createNextIntlMock } from './next-intl-mock'

// Components call useTranslations/useLocale, which throw outside a
// NextIntlClientProvider. Mock globally so tests render without wiring i18n;
// a file needing real copy re-mocks with createNextIntlMock({ key: 'texto' }).
vi.mock('next-intl', () => createNextIntlMock())
