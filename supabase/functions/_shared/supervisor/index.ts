import type { IReviewer } from './contracts.ts'
import { ConstitutionalReviewer } from './ConstitutionalReviewer.ts'
import { GroqReviewerLlm }        from './GroqReviewerLlm.ts'
import { addBreadcrumb }          from '../sentry.ts'

export * from './contracts.ts'
export { ConstitutionalReviewer } from './ConstitutionalReviewer.ts'
export { GroqReviewerLlm }        from './GroqReviewerLlm.ts'
export { REVIEWER_RUBRIC_VERSION, REVIEWER_SYSTEM_PROMPT } from './rubric.ts'
export { reviewWriteOrFailOpen } from './guard.ts'
export type { GuardInput, GuardOutcome } from './guard.ts'

/** DI composition root for the Deno (Edge Function) runtime. */
export function createConstitutionalReviewer(): IReviewer | null {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('GROQ_API_KEY') ?? ''
  if (!apiKey) return null

  const llm = new GroqReviewerLlm({ apiKey })

  return new ConstitutionalReviewer(llm, (stage, error) =>
    addBreadcrumb(`reviewer degraded at ${stage}`, 'supervisor', 'warning', { error }),
  )
}
