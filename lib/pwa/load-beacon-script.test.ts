/**
 * The load beacon runs as an inline script before any bundle, so it is tested by
 * running the exact string the layout injects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PWA_LOAD_BEACON_SCRIPT, PWA_LOAD_ENDPOINT } from './load-beacon-script'
import { parsePwaLoadReport } from './load-metrics'

let sent: Array<{ url: string; body: Record<string, unknown> }>

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

// Earlier runs leave their listeners on the shared window: keep only this run's reports.
let ownId = ''
const own = () => sent.filter((s) => s.body.id === ownId)

function run() {
  const before = sent.length
  // eslint-disable-next-line no-new-func
  new Function(PWA_LOAD_BEACON_SCRIPT)()
  ownId = String(sent[before]!.body.id)
  sent = sent.slice(before)
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string, body: string) => { sent.push({ url, body: JSON.parse(body) }); return true },
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(() => { vi.useRealTimers() })

describe('PWA load beacon', () => {
  it('reports the boot as soon as the HTML runs, in a shape the endpoint accepts', () => {
    run()
    expect(own()).toHaveLength(1)
    expect(sent[0]!.url).toBe(PWA_LOAD_ENDPOINT)
    expect(sent[0]!.body).toMatchObject({ phase: 'boot', path: '/', standalone: false, online: true })
    expect(['none', 'uncontrolled', 'controlled']).toContain(sent[0]!.body.sw)
    expect(parsePwaLoadReport(JSON.stringify(sent[0]!.body))).not.toBeNull()
  })

  it('reports the end of the load with the same id', () => {
    run()
    window.dispatchEvent(new Event('load'))
    vi.runAllTimers()
    expect(own().map((s) => s.body.phase)).toEqual(['boot', 'loaded'])
    expect(parsePwaLoadReport(JSON.stringify(own()[1]!.body))).not.toBeNull()
  })

  it('reports a page left before it finished loading', () => {
    run()
    setVisibility('hidden')
    expect(own().map((s) => s.body.phase)).toEqual(['boot', 'hidden'])
  })

  it('reports a page left before loading only once', () => {
    run()
    setVisibility('hidden')
    setVisibility('visible')
    setVisibility('hidden')
    expect(own().map((s) => s.body.phase)).toEqual(['boot', 'hidden'])
  })

  it('reports a return from the background after more than 5 s, and not a short one', () => {
    run()
    window.dispatchEvent(new Event('load'))
    vi.runAllTimers()
    setVisibility('hidden')
    vi.advanceTimersByTime(2000)
    setVisibility('visible')
    setVisibility('hidden')
    vi.advanceTimersByTime(60_000)
    setVisibility('visible')
    const mine = own()
    expect(mine.map((s) => s.body.phase)).toEqual(['boot', 'loaded', 'resume'])
    expect(mine[2]!.body.hiddenMs).toBeGreaterThanOrEqual(60_000)
    expect(parsePwaLoadReport(JSON.stringify(mine[2]!.body))).not.toBeNull()
  })

  it('marks an app opened from the home screen of an iPhone as standalone', () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    run()
    expect(sent[0]!.body.standalone).toBe(true)
    Reflect.deleteProperty(navigator, 'standalone')
  })
})
