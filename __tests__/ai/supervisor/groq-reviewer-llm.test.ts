/**
 * groq-reviewer-llm.test.ts — Unit tests for GroqReviewerLlm.
 *
 * Coverage:
 *   review — happy path: allow verdict parsed cleanly
 *   review — happy path: block verdict with rejection code
 *   review — request payload includes system prompt + structured user JSON
 *   review — pins model to openai/gpt-oss-20b and forces response_format json_object
 *   review — network throw returns Result.ok=false with "network" prefix
 *   review — non-2xx returns Result.ok=false with http status
 *   review — malformed body (no choices) → envelope schema error
 *   review — content not JSON → "content not json" error
 *   review — verdict with invalid rejection code → verdict schema error
 *   review — verdict with extra unknown field → verdict schema error (strict)
 *   review — similarity in recentMemory rounded to 3 decimals in payload
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GroqReviewerLlm } from '@/lib/ai/supervisor/GroqReviewerLlm'
import { REVIEWER_SYSTEM_PROMPT } from '@/lib/ai/supervisor/rubric'
import type { ReviewRequest } from '@/lib/ai/supervisor/contracts'

const REQUEST: ReviewRequest = {
  toolName: 'book_appointment',
  toolArgs: { clientName: 'Juan Pérez', date: '2026-06-01', time: '15:00' },
  scope:    { businessId: 'biz_1', channel: 'whatsapp' },
  userUtterance: 'agenda a Juan mañana 3pm',
  recentMemory: [
    { content: 'Juan Pérez agendó corte el 2026-05-10', similarity: 0.8765432109, createdAt: '2026-05-10T15:00:00Z' },
  ],
}

function groqOk(content: string) {
  return {
    ok:   true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response
}

function groqStatus(status: number, body: unknown = {}) {
  return {
    ok:   status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('GroqReviewerLlm.review', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses an allow verdict from a clean JSON envelope', async () => {
    fetchSpy.mockResolvedValueOnce(groqOk(JSON.stringify({
      verdict: 'allow', code: null, reason: 'target inequívoco',
    })))
    const llm = new GroqReviewerLlm({ apiKey: 'k' })
    const res = await llm.review(REQUEST)
    expect(res).toEqual({
      ok:    true,
      value: { verdict: 'allow', code: null, reason: 'target inequívoco' },
    })
  })

  it('parses a block verdict with a rejection code', async () => {
    fetchSpy.mockResolvedValueOnce(groqOk(JSON.stringify({
      verdict: 'block', code: 'AMBIGUOUS_TARGET', reason: 'dos Juan en memoria',
    })))
    const llm = new GroqReviewerLlm({ apiKey: 'k' })
    const res = await llm.review(REQUEST)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.verdict).toBe('block')
      expect(res.value.code).toBe('AMBIGUOUS_TARGET')
    }
  })

  it('sends system prompt, json_object response_format and pinned model', async () => {
    fetchSpy.mockResolvedValueOnce(groqOk(JSON.stringify({ verdict: 'allow', code: null, reason: 'ok' })))
    const llm = new GroqReviewerLlm({ apiKey: 'secret-key' })
    await llm.review(REQUEST)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer secret-key')

    const body = JSON.parse(init.body)
    expect(body.model).toBe('openai/gpt-oss-20b')
    expect(body.temperature).toBe(0)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0]).toEqual({ role: 'system', content: REVIEWER_SYSTEM_PROMPT })
    expect(body.messages[1].role).toBe('user')
  })

  it('rounds recentMemory similarity to 3 decimals in payload', async () => {
    fetchSpy.mockResolvedValueOnce(groqOk(JSON.stringify({ verdict: 'allow', code: null, reason: 'ok' })))
    await new GroqReviewerLlm({ apiKey: 'k' }).review(REQUEST)

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body)
    const userPayload = JSON.parse(body.messages[1].content)
    expect(userPayload.recentMemory[0].similarity).toBe(0.877)
  })

  it('returns Result.ok=false with "network" prefix when fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'))
    const res = await new GroqReviewerLlm({ apiKey: 'k' }).review(REQUEST)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/^network: /)
  })

  it('returns Result.ok=false with http status when Groq returns non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(groqStatus(503))
    const res = await new GroqReviewerLlm({ apiKey: 'k' }).review(REQUEST)
    expect(res).toEqual({ ok: false, error: 'http 503' })
  })

  it('returns envelope schema error when Groq body has no choices', async () => {
    fetchSpy.mockResolvedValueOnce(groqStatus(200, { choices: [] }))
    const res = await new GroqReviewerLlm({ apiKey: 'k' }).review(REQUEST)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/^envelope schema:/)
  })

  it('returns "content not json" when the model returns prose instead of JSON', async () => {
    fetchSpy.mockResolvedValueOnce(groqOk('claro que sí, todo bien'))
    const res = await new GroqReviewerLlm({ apiKey: 'k' }).review(REQUEST)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/^content not json:/)
  })

  it('returns verdict schema error for unknown rejection code', async () => {
    fetchSpy.mockResolvedValueOnce(groqOk(JSON.stringify({
      verdict: 'block', code: 'NUCLEAR_LAUNCH', reason: 'x',
    })))
    const res = await new GroqReviewerLlm({ apiKey: 'k' }).review(REQUEST)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/^verdict schema:/)
  })

  it('rejects extra unknown fields under strict schema', async () => {
    fetchSpy.mockResolvedValueOnce(groqOk(JSON.stringify({
      verdict: 'allow', code: null, reason: 'ok', extra: 'nope',
    })))
    const res = await new GroqReviewerLlm({ apiKey: 'k' }).review(REQUEST)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/^verdict schema:/)
  })
})
