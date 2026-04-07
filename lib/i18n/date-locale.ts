import type { Locale as DateFnsLocale } from 'date-fns'
import type { Locale } from '@/i18n/routing'

// ── Async map: Locale → date-fns locale ──────────────────────────────────────
// Tree-shakeable: only the requested locale is bundled per page.
// Usage in Client Components:
//   const [dateFnsLocale, setDateFnsLocale] = useState<DateFnsLocale>()
//   useEffect(() => { DATE_FNS_LOCALE_MAP[locale]().then(setDateFnsLocale) }, [locale])
//
// Usage in Server Components / async contexts:
//   const dateFnsLocale = await getDateFnsLocale(locale)

export const DATE_FNS_LOCALE_MAP: Record<Locale, () => Promise<DateFnsLocale>> = {
  es: () => import('date-fns/locale/es').then(m => m.es),
  en: () => import('date-fns/locale/en-US').then(m => m.enUS),
  pt: () => import('date-fns/locale/pt-BR').then(m => m.ptBR),
  fr: () => import('date-fns/locale/fr').then(m => m.fr),
  de: () => import('date-fns/locale/de').then(m => m.de),
  it: () => import('date-fns/locale/it').then(m => m.it),
}

export async function getDateFnsLocale(locale: Locale): Promise<DateFnsLocale> {
  return DATE_FNS_LOCALE_MAP[locale]()
}
