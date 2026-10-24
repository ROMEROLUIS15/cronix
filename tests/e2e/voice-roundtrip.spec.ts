/**
 * voice-roundtrip.spec.ts — real audio through the dashboard voice assistant.
 *
 * Runs only in the `voice` Playwright project, where Chromium's fake microphone
 * loops fixtures/voice/que-citas-tengo-hoy.wav (0.5 s silence, the question,
 * 2 s silence). Every turn goes through the real MediaRecorder, the deployed
 * voice-worker, Deepgram and the agent, so it needs network and the E2E user.
 *
 * It guards what broke in prod on 2026-10-23: after a few turns, and after
 * dismissing an answer, the uploaded WebM lost its header and Deepgram rejected
 * it (the voice-worker then answers 400). The answer text is never compared —
 * the LLM wording varies.
 *
 * Regenerate the fixtures (Deepgram TTS voice aura-2-nestor-es + ffmpeg):
 *   POST https://api.deepgram.com/v1/speak?model=aura-2-nestor-es&encoding=linear16&sample_rate=48000&container=wav
 *        body {"text":"¿Qué citas tengo hoy?"} (send it as UTF-8)
 *   ffmpeg -i raw.wav -af "adelay=500:all=1,apad=pad_dur=2" -ac 1 -ar 16000 -c:a pcm_s16le que-citas-tengo-hoy.wav
 *   ffmpeg -i que-citas-tengo-hoy.wav -c:a libopus -b:a 32k que-citas-tengo-hoy.webm
 */

import { test, expect, type Page, type Response } from '@playwright/test'
import { transcribedQuestion } from './fixtures/voice/question'

const FAB = '[data-testid="voice-assistant-fab"]'

const isVoiceWorkerPost = (res: Response) =>
  res.url().includes('/functions/v1/voice-worker') && res.request().method() === 'POST'

async function askAndGetAnswer(page: Page) {
  const fab = page.locator(FAB)
  const answered = page.waitForResponse(isVoiceWorkerPost, { timeout: 45_000 })
  await fab.click()
  await expect(fab).toHaveAttribute('data-state', 'listening')
  // The FAB stops on its own (silence after speech, or the 10 s hard cap).
  const res = await answered
  return { res, body: await res.json() as { transcription?: string; error?: string } }
}

test('four turns in a row, one with the answer dismissed, are recorded intact and transcribed', async ({ page }, testInfo) => {
  test.setTimeout(180_000)

  // A turn that ends without reaching the voice-worker leaves no trace anywhere
  // else, so record the FAB's state transitions, its logs, what it tried to say
  // aloud and any failed request — and print them in full when the test fails
  // (the list reporter truncates attachments).
  const diagnostics: string[] = []
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((records) => {
        for (const r of records) {
          const el = r.target as HTMLElement
          if (el.dataset?.testid === 'voice-assistant-fab') console.log(`[fab-state] ${el.dataset.state}`)
        }
      }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-state'] })
    }, { once: true })
  })
  page.on('console', (msg) => {
    if (!msg.text().startsWith('[PWA]')) diagnostics.push(`[console.${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => diagnostics.push(`[pageerror] ${err.message}`))
  page.on('requestfailed', (req) => {
    // Next aborts its route prefetches (?_rsc=) on navigation — noise, not a failure.
    if (req.url().includes('_rsc=')) return
    diagnostics.push(`[requestfailed] ${req.method()} ${req.url()} ${req.failure()?.errorText ?? ''}`)
  })
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.pathname === '/api/assistant/tts') diagnostics.push(`[tts] ${url.searchParams.get('t')}`)
  })
  try {
    await runTurns(page)
  } catch (err) {
    console.log(`--- FAB diagnostics ---\n${diagnostics.join('\n')}\n-----------------------`)
    throw err
  } finally {
    await testInfo.attach('fab-diagnostics', { body: diagnostics.join('\n'), contentType: 'text/plain' })
  }
})

async function runTurns(page: Page) {
  await page.goto('/dashboard')
  const fab = page.locator(FAB)
  await fab.waitFor({ state: 'visible', timeout: 15_000 })

  for (const turn of [1, 2, 3, 4]) {
    await test.step(`turn ${turn}`, async () => {
      const { res, body } = await askAndGetAnswer(page)

      // Corrupt audio (the 2026-10-23 bug) makes Deepgram reject it → 400 here.
      expect(res.status(), `voice-worker answered: ${body.error ?? 'ok'}`).toBe(200)
      expect(transcribedQuestion(body.transcription), `transcription: ${body.transcription}`).toBe(true)

      if (turn === 2) {
        // Dismiss the answer while it is being spoken and ask again right away:
        // the sequence that left an orphaned recorder in prod.
        await expect(fab).toHaveAttribute('data-state', 'speaking', { timeout: 15_000 })
        await fab.click()
      }
      await expect(fab).toHaveAttribute('data-state', 'idle', { timeout: 30_000 })
    })
  }
}
