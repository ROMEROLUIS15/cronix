/**
 * Shared next-intl mock for component tests.
 *
 * Components under test call useTranslations/useLocale, which throw outside a
 * NextIntlClientProvider. Rather than each test hand-rolling a partial mock
 * (the historic cause of "No useLocale export is defined" and "t.rich is not a
 * function"), they share this factory.
 *
 * By default t() resolves against the REAL es.json messages, so components
 * render the same copy they render in prod and assertions can match on Spanish
 * text. Pass an override map to force specific keys (or to assert on raw keys):
 *   createNextIntlMock({ 'form.save': 'Guardar' })
 */
import React from 'react'
import esMessages from '@/messages/es.json'

type Translations = Record<string, string>

function resolvePath(path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      esMessages,
    )
  return typeof value === 'string' ? value : undefined
}

function interpolate(raw: string, values?: Record<string, unknown>): string {
  if (!values) return raw
  return Object.entries(values).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    raw,
  )
}

export function createTranslator(overrides: Translations = {}, namespace?: string) {
  // Override map wins, then the real es.json copy, then the bare key.
  const lookup = (key: string): string =>
    overrides[key] ?? resolvePath(namespace ? `${namespace}.${key}` : key) ?? key

  const t = (key: string, values?: Record<string, unknown>) => interpolate(lookup(key), values)

  // t.rich renders chunks through the caller's tag functions; t.raw returns the
  // untouched value (used for the arrays/objects in the legal pages).
  t.rich = (
    key: string,
    tags: Record<string, (chunks: React.ReactNode) => React.ReactNode> = {},
  ) => {
    const raw = lookup(key)
    // Render `<tag>text</tag>` chunks by handing the tag name to its renderer.
    const parts = Object.entries(tags).map(([name, render], i) => (
      <React.Fragment key={i}>{render(name)}</React.Fragment>
    ))
    return (
      <>
        {raw}
        {parts}
      </>
    )
  }
  t.raw = (key: string) => {
    if (key in overrides) return overrides[key]
    const path = namespace ? `${namespace}.${key}` : key
    return path
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
        esMessages,
      ) ?? key
  }
  t.markup = (key: string, values?: Record<string, unknown>) => interpolate(lookup(key), values)
  t.has = (key: string) => key in overrides || resolvePath(namespace ? `${namespace}.${key}` : key) !== undefined

  return t
}

export function createNextIntlMock(overrides: Translations = {}, locale = 'es') {
  return {
    useTranslations: (namespace?: string) => createTranslator(overrides, namespace),
    useLocale: () => locale,
    useFormatter: () => ({
      dateTime: (value: Date) => String(value),
      number: (value: number) => String(value),
      relativeTime: (value: Date) => String(value),
      list: (value: Iterable<string>) => Array.from(value).join(', '),
    }),
    useNow: () => new Date(),
    useTimeZone: () => 'America/Caracas',
    useMessages: () => esMessages,
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
}
