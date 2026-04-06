# Deprecated APIs & Endpoints

This document tracks APIs and endpoints that have been deprecated and are scheduled for removal. Use this to coordinate with teams and plan migration timelines.

---

## Active Deprecations

| Endpoint | Status | Deprecated Since | Replacement | Reason | Notes | Safe to Delete When |
|----------|--------|-------------------|-------------|--------|-------|-------------------|
| `GET /api/assistant/token` | DEPRECATED | 2026-04-05 | `POST /api/assistant/voice` | Architecture V5 moved token generation server-side. All STT/TTS now handled by backend. Frontend sends audio blobs directly. | Returns HTTP 410 Gone. Logged as `logger.error('DEPRECATED-ENDPOINT', ...)` in Sentry with User-Agent for tracking. Invocations by stale JS sessions (not Service Workers) only. | Sentry shows 0 hits on tag `DEPRECATED-ENDPOINT` for 30 consecutive days |

---

## Removal Process

1. **Deprecation announced** — endpoint returns 410 Gone + logs to Sentry
2. **30-day monitoring window** — track invocation frequency in Sentry dashboard under Issues → `DEPRECATED-ENDPOINT`
3. **Safe removal** — when 0 hits observed for 30 days, file can be deleted from codebase

### Sentry Monitoring Query

In Sentry **Issues**, filter for:
```
tag:DEPRECATED-ENDPOINT
```

Track daily/weekly hit counts. Once trending to zero for 30 consecutive days, safe to delete.

---

## Historical Deprecations

(None yet — this is the first deprecation window.)
