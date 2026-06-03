import { z } from 'zod'
import type {
  IReviewerLlm,
  ReviewRequest,
  ReviewerLlmResponse,
  Result,
} from './contracts.ts'
import { REVIEWER_RUBRIC_VERSION, REVIEWER_SYSTEM_PROMPT } from './rubric.ts'

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL    = 'llama-3.1-8b-instant'

const REJECTION_CODES = [
  'TENANT_MISMATCH',
  'DUPLICATE_INTENT',
  'CONTRADICTS_MEMORY',
  'POLICY_VIOLATION',
  'AMBIGUOUS_TARGET',
  'UNSAFE_ARGS',
] as const

const ReviewerResponseSchema = z.object({
  verdict: z.enum(['allow', 'block', 'warn']),
  code:    z.enum(REJECTION_CODES).nullable(),
  reason:  z.string().max(280),
}).strict()

const GroqChoiceSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
  })).min(1),
}).passthrough()

export interface GroqReviewerConfig {
  readonly apiKey:     string
  readonly endpoint?:  string
  readonly model?:     string
  readonly temperature?: number
}

export class GroqReviewerLlm implements IReviewerLlm {
  private readonly apiKey:      string
  private readonly endpoint:    string
  private readonly model:       string
  private readonly temperature: number

  constructor(config: GroqReviewerConfig) {
    this.apiKey      = config.apiKey
    this.endpoint    = config.endpoint    ?? GROQ_ENDPOINT
    this.model       = config.model       ?? GROQ_MODEL
    this.temperature = config.temperature ?? 0
  }

  async review(request: ReviewRequest): Promise<Result<ReviewerLlmResponse>> {
    const userPayload = buildUserPayload(request)

    let res: Response
    try {
      res = await fetch(this.endpoint, {
        method:  'POST',
        headers: {
          'Authorization':       `Bearer ${this.apiKey}`,
          'Content-Type':        'application/json',
          'X-Reviewer-Rubric':   REVIEWER_RUBRIC_VERSION,
        },
        body: JSON.stringify({
          model:           this.model,
          temperature:     this.temperature,
          max_tokens:      120,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
            { role: 'user',   content: userPayload },
          ],
        }),
      })
    } catch (err) {
      return { ok: false, error: `network: ${errorMessage(err)}` }
    }

    if (!res.ok) {
      return { ok: false, error: `http ${res.status}` }
    }

    let raw: unknown
    try {
      raw = await res.json()
    } catch (err) {
      return { ok: false, error: `body parse: ${errorMessage(err)}` }
    }

    const envelope = GroqChoiceSchema.safeParse(raw)
    if (!envelope.success) {
      return { ok: false, error: `envelope schema: ${envelope.error.message}` }
    }

    const content = envelope.data.choices[0]!.message.content.trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (err) {
      return { ok: false, error: `content not json: ${errorMessage(err)}` }
    }

    const verdict = ReviewerResponseSchema.safeParse(parsed)
    if (!verdict.success) {
      return { ok: false, error: `verdict schema: ${verdict.error.message}` }
    }

    return { ok: true, value: verdict.data }
  }
}

function buildUserPayload(request: ReviewRequest): string {
  return JSON.stringify({
    toolName:      request.toolName,
    toolArgs:      request.toolArgs,
    scope:         request.scope,
    userUtterance: request.userUtterance,
    recentMemory:  request.recentMemory.map((m) => ({
      content:    m.content,
      similarity: Number(m.similarity.toFixed(3)),
      createdAt:  m.createdAt,
    })),
  })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
