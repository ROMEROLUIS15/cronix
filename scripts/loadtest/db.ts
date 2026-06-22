/**
 * Shared connection helper for the load-test harness.
 *
 * SAFETY: refuses to connect to anything that is not the LOCAL Supabase Postgres.
 * The whole point of the experiment is to never touch the free-tier / production
 * project, so a non-local host is a hard error — not a warning.
 */
import { Client } from 'pg'

// Default = the connection string `supabase start` prints for the local stack.
const DEFAULT_LOCAL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export function resolveLocalUrl(): string {
  const url = process.env.LOADTEST_DATABASE_URL ?? DEFAULT_LOCAL
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`LOADTEST_DATABASE_URL is not a valid URL: ${url}`)
  }
  const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  if (!isLocal) {
    throw new Error(
      `Refusing to run against non-local host "${host}". ` +
      `This harness only targets the local Docker stack (127.0.0.1:54322). ` +
      `Never point it at a *.supabase.co URL.`,
    )
  }
  return url
}

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: resolveLocalUrl() })
  await client.connect()
  return client
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`)
  return Math.floor(n)
}
