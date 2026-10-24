/**
 * usePwaUpdate — when a service worker taking control reloads the page.
 *
 * The first install also fires `controllerchange` (clientsClaim moves the page
 * from no controller to the new worker). Reloading there wiped whatever a
 * first-time visitor was doing ~1 min after landing (prod, 2026-10-24) and
 * killed the voice E2E mid-recording.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePwaUpdate } from './use-pwa-update'

const originalLocation = window.location
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')

let reload: ReturnType<typeof vi.fn>
let unmount: (() => void) | undefined
let container: EventTarget & { controller: object | null; getRegistration: ReturnType<typeof vi.fn> }

function installServiceWorker(controllerAtLoad: object | null) {
  const registration = Object.assign(new EventTarget(), { waiting: null, installing: null })
  container = Object.assign(new EventTarget(), {
    controller: controllerAtLoad,
    getRegistration: vi.fn().mockResolvedValue(registration),
  })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
}

async function mountAndTakeControl() {
  ;({ unmount } = renderHook(() => usePwaUpdate()))
  await waitFor(() => expect(container.getRegistration).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  container.controller = {}
  container.dispatchEvent(new Event('controllerchange'))
}

beforeEach(() => {
  reload = vi.fn()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } })
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
  else delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

describe('usePwaUpdate — reload on controllerchange', () => {
  it('does not reload when the first service worker takes control of the page', async () => {
    installServiceWorker(null)
    await mountAndTakeControl()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads when a new version replaces the worker that controlled the page', async () => {
    installServiceWorker({})
    await mountAndTakeControl()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
