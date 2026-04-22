'use client'

import { useState, useEffect } from 'react'

export interface PwaInstallFallbackState {
  browserType: 'chrome' | 'safari' | 'firefox' | 'unknown'
  isAndroid: boolean
  isIos: boolean
  hasManifest: boolean
  hasSW: boolean
  instruction: string
}

export function usePwaInstallFallback(): PwaInstallFallbackState {
  const [state, setState] = useState<PwaInstallFallbackState>({
    browserType: 'unknown',
    isAndroid: false,
    isIos: false,
    hasManifest: false,
    hasSW: false,
    instruction: '',
  })

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase()
    const isAndroid = /android/.test(ua)
    const isIos = /iphone|ipad|ipod/.test(ua)

    let browserType: 'chrome' | 'safari' | 'firefox' | 'unknown' = 'unknown'
    if (/chrome|chromium|crios/.test(ua) && !/edg/.test(ua)) {
      browserType = 'chrome'
    } else if (/safari/.test(ua) && !/chrome/.test(ua)) {
      browserType = 'safari'
    } else if (/firefox/.test(ua)) {
      browserType = 'firefox'
    }

    const hasManifest = !!document.querySelector('link[rel="manifest"]')
    const hasSW = 'serviceWorker' in navigator

    let instruction = ''
    if (isAndroid && browserType === 'chrome') {
      instruction = '🤖 Android: Tap the ⋮ menu (top right) > Install app'
    } else if (isIos) {
      instruction = '🍎 iOS: Tap Share button > Add to Home Screen'
    } else if (isAndroid) {
      instruction = '🤖 Android: Use your browser menu to install'
    } else if (browserType === 'safari') {
      instruction = '🍎 Safari: Tap Share button > Add to Home Screen'
    } else {
      instruction = '✨ Your browser supports app installation'
    }

    setState({
      browserType,
      isAndroid,
      isIos,
      hasManifest,
      hasSW,
      instruction,
    })
  }, [])

  return state
}
