/**
 * server-timing.ts — The time of each step of a request, in the `Server-Timing` header.
 *
 * The agent measures how long it waits on each request; this header says where that time goes
 * inside the function (signature, database client, the route with its queries) and, compared
 * with the execution time Supabase logs, how much is spent outside it.
 */

export class StepTimer {
  private readonly startedAt = performance.now()
  private lastAt = this.startedAt
  private readonly steps: Array<[string, number]> = []

  /** Closes the step in progress under this name. */
  mark(step: string): void {
    const now = performance.now()
    this.steps.push([step, now - this.lastAt])
    this.lastAt = now
  }

  /** `signature;dur=1.2, ...`: the closed steps and the total since the start, in milliseconds. */
  header(): string {
    const total: [string, number] = ['total', performance.now() - this.startedAt]
    return [...this.steps, total].map(([step, ms]) => `${step};dur=${ms.toFixed(1)}`).join(', ')
  }
}
