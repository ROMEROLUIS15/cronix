import { z } from 'zod'

const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000

/** One report from the load beacon, as the browser sends it. */
export const PwaLoadReportSchema = z.object({
  id:         z.string().min(1).max(20),
  phase:      z.enum(['boot', 'loaded', 'hidden', 'resume']),
  path:       z.string().max(120),
  standalone: z.boolean(),
  sw:         z.enum(['none', 'uncontrolled', 'controlled']),
  online:     z.boolean(),
  // Time since the page opened: an installed app can stay open for days.
  elapsed:    z.number().int().min(0).max(MAX_DURATION_MS),
  navType:    z.string().max(20),
  response:   z.number().int().min(0).max(3_600_000),
  dom:        z.number().int().min(0).max(3_600_000),
  load:       z.number().int().min(0).max(3_600_000),
  worker:     z.number().int().min(0).max(3_600_000),
  transfer:   z.number().int().min(0).max(100_000_000),
  fcp:        z.number().int().min(0).max(3_600_000),
  hiddenMs:   z.number().int().min(0).max(MAX_DURATION_MS),
}).strict()

export type PwaLoadReport = z.infer<typeof PwaLoadReportSchema>

export interface PwaLoadEntry extends PwaLoadReport {
  at:         string
  businessId: string | null
  ua:         string
}

export const PWA_LOAD_KEY = 'pwa:loads:v1'
export const PWA_LOAD_MAX_ENTRIES = 5000
export const PWA_LOAD_TTL_SECS = 30 * 24 * 60 * 60
/** Larger bodies are dropped without parsing: a real report is well under 1 KB. */
export const PWA_LOAD_MAX_BYTES = 2048

/** Parses a raw beacon body; null when it is too big, not JSON or not a report. */
export function parsePwaLoadReport(raw: string): PwaLoadReport | null {
  if (raw.length > PWA_LOAD_MAX_BYTES) return null
  let json: unknown
  try { json = JSON.parse(raw) } catch { return null }
  const parsed = PwaLoadReportSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

interface ListStore {
  lpush(key: string, value: string): Promise<unknown>
  ltrim(key: string, start: number, stop: number): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
}

/** Keeps the newest entries only, for 30 days, so the list can never grow without bound. */
export async function storePwaLoad(store: ListStore, entry: PwaLoadEntry): Promise<void> {
  await store.lpush(PWA_LOAD_KEY, JSON.stringify(entry))
  await store.ltrim(PWA_LOAD_KEY, 0, PWA_LOAD_MAX_ENTRIES - 1)
  await store.expire(PWA_LOAD_KEY, PWA_LOAD_TTL_SECS)
}
