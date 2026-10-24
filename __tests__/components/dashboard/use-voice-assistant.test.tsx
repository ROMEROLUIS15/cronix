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
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

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
      ? { ok: true, status: 200, json: async () => ({ text: 'María vino el 3 de octubre.', audioUrl: null, actionPerformed: false, transcription: 'cuándo vino María' }) }
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

  it('keeps recording past 6 s and stops at the 10 s hard cap when VAD never detects speech', async () => {
    const start = now
    await startListening(DESKTOP_EDGE_UA)
    const recorder = FakeMediaRecorder.instances[0]!

    now = start + 300     // noise-floor calibration window (200 ms) elapses
    runFrame()
    now = start + 7_000
    runFrame()
    expect(recorder.state).toBe('recording')

    now = start + 10_000
    runFrame()
    expect(recorder.state).toBe('inactive')
  })
})
