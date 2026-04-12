/**
 * Custom Service Worker additions for Cronix — merged by next-pwa into sw.js.
 *
 * next-pwa (v5) reads this file during `next build` and bundles it together
 * with the Workbox-generated service worker. Any event listeners added here
 * will run inside the compiled sw.js.
 *
 * What this handles:
 *  - push: receives encrypted Web Push payloads from the push-notify Edge
 *    Function and shows a native OS notification with the Cronix logo.
 *  - notificationclick: when the user taps a notification, navigates to the
 *    URL embedded in the notification data (or /dashboard as fallback).
 *    Focuses an already-open Cronix tab rather than opening a new one.
 *
 * Push payload shape (JSON):
 *   { title?: string, body?: string, url?: string, icon?: string }
 */

/* global self, clients */

// ── One-Click Update: skip waiting on demand ─────────────────────────────────
// The usePwaUpdate hook sends this message when the user clicks "Actualizar".
// Without this, a new SW in "waiting" state would never activate.
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// ── Push subscription change ─────────────────────────────────────────────────
// When a push subscription expires or is revoked by the browser (common on
// Android), this handler fires. We notify the main app to re-subscribe so
// push notifications don't silently stop working.
self.addEventListener('pushsubscriptionchange', function (event) {
  // Notify all open windows to re-subscribe to push notifications
  self.clients.matchAll({ type: 'window' }).then(function (clients) {
    clients.forEach(function (client) {
      client.postMessage({ type: 'PUSH_SUBSCRIPTION_EXPIRED' })
    })
  })
})

// ── Push event ───────────────────────────────────────────────────────────────
self.addEventListener('push', function (event) {
  var data = {}

  if (event.data) {
    try {
      data = event.data.json()
    } catch (_err) {
      // Fallback: treat raw text as notification body
      data = { body: event.data.text() }
    }
  }

  var title   = data.title   || 'Cronix'
  var options = {
    body:      data.body    || 'Tienes una nueva notificación',
    icon:      data.icon    || '/icon-192x192.png',
    badge:     '/icon-192x192.png',   // small mono icon shown in status bar (Android)
    image:     data.image   || undefined,
    data:      { url: data.url || '/dashboard' },
    vibrate:   [200, 100, 200],
    tag:       'cronix-push',         // replaces previous notification of same tag
    renotify:  false,
    silent:    false,
    requireInteraction: false,
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  var targetUrl = '/dashboard'
  if (event.notification.data && event.notification.data.url) {
    targetUrl = event.notification.data.url
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (openWindows) {
      // Focus an existing Cronix tab if one is open at the target URL
      for (var i = 0; i < openWindows.length; i++) {
        var win = openWindows[i]
        if (win.url === targetUrl && 'focus' in win) {
          return win.focus()
        }
      }
      // No matching tab — open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})
