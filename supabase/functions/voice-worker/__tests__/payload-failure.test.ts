/**
 * A failure before the agent runs (body parse → STT → context load) must reach
 * ai_traces with the stage that broke, and the owner must hear a sentence they
 * can act on — never "Payload inválido o error de contexto".
 */

import { describe, it, expect } from 'vitest'
import { classifyPayloadFailure, tagStage } from '../core/payload-failure.ts'

const deepgram400 = new Error('Deepgram STT 400: corrupt or unsupported data')

describe('classifyPayloadFailure', () => {
  it('classifies a rejected transcription as STT_FAILED and keeps the original error', async () => {
    const err = await tagStage('STT_FAILED', Promise.reject(deepgram400)).catch((e: unknown) => e)
    expect(classifyPayloadFailure(err)).toEqual({
      code:    'STT_FAILED',
      message: 'No pude procesar el audio, ¿puedes repetir?',
      cause:   deepgram400,
    })
  })

  it('classifies a rejected context load as CONTEXT_FAILED', async () => {
    const dbDown = new Error('connection reset')
    const err = await tagStage('CONTEXT_FAILED', Promise.reject(dbDown)).catch((e: unknown) => e)
    expect(classifyPayloadFailure(err)).toEqual({
      code:    'CONTEXT_FAILED',
      message: 'No pude cargar los datos de tu negocio. Intenta de nuevo en unos segundos.',
      cause:   dbDown,
    })
  })

  it('classifies anything untagged (malformed body) as PAYLOAD_INVALID', () => {
    const parseError = new SyntaxError('Unexpected end of JSON input')
    expect(classifyPayloadFailure(parseError)).toEqual({
      code:    'PAYLOAD_INVALID',
      message: 'No pude leer tu mensaje. Intenta de nuevo.',
      cause:   parseError,
    })
  })
})

describe('tagStage', () => {
  it('passes a successful value through untouched', async () => {
    await expect(tagStage('STT_FAILED', Promise.resolve('hola'))).resolves.toBe('hola')
  })
})
