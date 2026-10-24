import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { useVoiceAssistant } from '@/components/dashboard/use-voice-assistant'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const DESKTOP_EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
const ANDROID_UA      = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = () => true
  state: RecordingState = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(readonly stream: MediaStream, readonly options: MediaRecorderOptions) {
    FakeMediaRecorder.instances.push(this)
  }
  start() { this.state = 'recording' }
  stop()  { this.state = 'inactive'; this.onstop?.() }
}

// Silent mic: every sample sits at the 128 midpoint, so VAD never detects speech
// and only the hard cap (or a tap) ends the recording.
class FakeAudioContext {
  state: AudioContextState = 'running'
  resume = vi.fn(async () => {})
  close  = vi.fn(async () => {})
  createAnalyser() {
    return { fftSize: 0, smoothingTimeConstant: 0, getByteTimeDomainData: (arr: Uint8Array) => arr.fill(128) }
  }
  createMediaStreamSource() { return { connect: vi.fn() } }
}

const supabase = {
  auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } }) },
} as unknown as SupabaseClient
const queryClient = { invalidateQueries: vi.fn() } as unknown as QueryClient

let frames: FrameRequestCallback[] = []
const runFrame = () => act(() => { frames.shift()?.(0) })
let playedEls: HTMLMediaElement[] = []

const VOICE_WORKER_OK = {
  ok: true, status: 200,
  json: async () => ({ text: 'María vino el 3 de octubre.', audioUrl: null, actionPerformed: false, transcription: 'cuándo vino María' }),
}
const voiceWorkerCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/functions/v1/voice-worker'))

const getUserMedia = vi.fn()
const speechRecognitionCtor = vi.fn()
const fetchMock = vi.fn()
let now = 0

const setUserAgent = (ua: string) =>
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })

const startListening = async (ua: string) => {
  setUserAgent(ua)
  const hook = renderHook(() => useVoiceAssistant(supabase, queryClient))
  act(() => hook.result.current.handleClick())
  await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1))
  return hook
}

beforeEach(() => {
  FakeMediaRecorder.instances = []
  frames = []
  playedEls = []
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    playedEls.push(this)
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  URL.createObjectURL = vi.fn(() => 'blob:tts')
  URL.revokeObjectURL = vi.fn()

  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
  Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  // Desktop Chrome/Edge expose the Web Speech API — the hook must not use it.
  speechRecognitionCtor.mockReset()
  vi.stubGlobal('SpeechRecognition', speechRecognitionCtor)
  vi.stubGlobal('webkitSpeechRecognition', speechRecognitionCtor)

  fetchMock.mockReset().mockImplementation(async (url: string) =>
    url.includes('/functions/v1/voice-worker')
      ? VOICE_WORKER_OK
      : { ok: false, status: 503, json: async () => ({}) },
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window.navigator as { userAgent?: string }).userAgent
  delete (window.navigator as { mediaDevices?: unknown }).mediaDevices
})

describe('useVoiceAssistant — recording', () => {
  it.each([
    ['desktop (Edge/Chrome)', DESKTOP_EDGE_UA],
    ['mobile (Android)',      ANDROID_UA],
  ])('records audio for the server-side STT on %s, never the browser Web Speech API', async (_label, ua) => {
    const { result } = await startListening(ua)

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(speechRecognitionCtor).not.toHaveBeenCalled()
    expect(result.current.state).toBe('listening')
  })

  it('sends the recorded audio to the voice-worker as multipart with the user JWT when the user taps stop', async () => {
    const { result } = await startListening(DESKTOP_EDGE_UA)
    const recorder = FakeMediaRecorder.instances[0]!
    recorder.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) })

    act(() => result.current.handleClick())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/voice-worker'),
      expect.objectContaining({ method: 'POST' }),
    ))
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).includes('/functions/v1/voice-worker'))!
    const body = (init as RequestInit).body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('audio')).toBeInstanceOf(Blob)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-123' })
  })

  // CI 2026-10-24 (second cause): the recorder was only created after awaiting
  // AudioContext.resume(), which never settles without an audio device (headless CI) or
  // outside a user gesture (iOS) — the FAB stayed "listening" and nothing was recorded.
  it('starts recording and arms the hard cap even when AudioContext.resume() never settles', async () => {
    class StuckAudioContext extends FakeAudioContext {
      override state: AudioContextState = 'suspended'
      override resume = vi.fn(() => new Promise<void>(() => {}))
    }
    vi.stubGlobal('AudioContext', StuckAudioContext)
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    await startListening(DESKTOP_EDGE_UA)

    expect(FakeMediaRecorder.instances[0]!.state).toBe('recording')
    expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === 10_000)).toBe(true)
  })

  // CI 2026-10-24: the FAB went "listening" and never stopped — the cap lived inside the
  // rAF loop, and rAF pauses in a background tab or a throttled headless browser.
  it('stops at the 10 s hard cap from its own timer, even when no animation frame runs', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    await startListening(DESKTOP_EDGE_UA)
    const recorder = FakeMediaRecorder.instances[0]!

    const cap = setTimeoutSpy.mock.calls.find(([, ms]) => ms === 10_000)
    expect(cap, 'a 10 s hard-cap timer is armed when recording starts').toBeDefined()
    expect(recorder.state).toBe('recording')

    act(() => { (cap![0] as () => void)() })
    expect(recorder.state).toBe('inactive')
  })

  it('a tap that stops the recording first disarms the hard cap', async () => {
    const setTimeoutSpy  = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { result } = await startListening(DESKTOP_EDGE_UA)
    const capIndex = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === 10_000)
    expect(capIndex).toBeGreaterThanOrEqual(0)
    const capId = setTimeoutSpy.mock.results[capIndex]!.value

    act(() => result.current.handleClick())
    expect(clearTimeoutSpy).toHaveBeenCalledWith(capId)
  })
})

describe('useVoiceAssistant — one recording at a time', () => {
  it('a late "answer finished" from the previous turn does not flip a live recording to idle, and the next tap stops it', async () => {
    let resolveTts: (res: unknown) => void = () => {}
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/functions/v1/voice-worker')) return VOICE_WORKER_OK
      if (url.startsWith('/api/assistant/tts?')) return new Promise((r) => { resolveTts = r })
      return { ok: true, status: 204, json: async () => ({}) }
    })
    const { result } = await startListening(DESKTOP_EDGE_UA)
    FakeMediaRecorder.instances[0]!.ondataavailable?.({ data: new Blob(['turn-1']) })

    act(() => result.current.handleClick())                     // stop turn 1 → answer is being synthesised
    await waitFor(() => expect(result.current.state).toBe('speaking'))
    act(() => result.current.handleClick())                     // dismiss the answer before it plays
    act(() => result.current.handleClick())                     // ask the next question
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(2))
    const second = FakeMediaRecorder.instances[1]!

    await act(async () => { resolveTts({ ok: true, status: 200, blob: async () => new Blob(['mp3']) }) })
    await act(async () => { for (const el of playedEls) el.onended?.(new Event('ended')) })
    expect(result.current.state).toBe('listening')

    act(() => result.current.handleClick())
    expect(FakeMediaRecorder.instances).toHaveLength(2)
    expect(second.state).toBe('inactive')
  })

  it('a request cancelled while its error body is still being read does not speak over the next recording', async () => {
    let resolveErrorBody: (body: unknown) => void = () => {}
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/functions/v1/voice-worker')
        ? { ok: false, status: 400, json: () => new Promise((r) => { resolveErrorBody = r }) }
        : { ok: false, status: 503, json: async () => ({}) },
    )
    const { result } = await startListening(DESKTOP_EDGE_UA)
    FakeMediaRecorder.instances[0]!.ondataavailable?.({ data: new Blob(['turn-1']) })

    act(() => result.current.handleClick())                     // stop → request in flight
    await waitFor(() => expect(voiceWorkerCalls()).toHaveLength(1))
    await waitFor(() => expect(result.current.state).toBe('processing'))
    act(() => result.current.handleClick())                     // cancel it
    act(() => result.current.handleClick())                     // ask again
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(2))

    await act(async () => { resolveErrorBody({ error: 'No pude procesar el audio, ¿puedes repetir?' }) })
    expect(result.current.state).toBe('listening')
  })

  it('sends only the audio of the current recording, never chunks emitted by a previous recorder', async () => {
    const { result } = await startListening(DESKTOP_EDGE_UA)
    const first = FakeMediaRecorder.instances[0]!
    first.ondataavailable?.({ data: new Blob(['first']) })
    act(() => result.current.handleClick())
    await waitFor(() => expect(result.current.state).toBe('idle'))

    act(() => result.current.handleClick())
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(2))
    const second = FakeMediaRecorder.instances[1]!
    first.ondataavailable?.({ data: new Blob(['stray']) })
    second.ondataavailable?.({ data: new Blob(['second']) })
    act(() => result.current.handleClick())

    await waitFor(() => expect(voiceWorkerCalls()).toHaveLength(2))
    const audio = ((voiceWorkerCalls()[1]![1] as RequestInit).body as FormData).get('audio') as Blob
    expect(await audio.text()).toBe('second')
  })
})
