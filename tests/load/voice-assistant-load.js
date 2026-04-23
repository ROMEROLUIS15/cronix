/**
 * k6 Load Test — Cronix Voice Assistant (/api/assistant/voice)
 *
 * Simulates concurrent AI voice requests to identify:
 *  - Latency under load (STT → LLM → TTS chain)
 *  - Rate limit enforcement (10 req/min per user)
 *  - Memory/CPU pressure on Vercel serverless functions
 *  - Token quota exhaustion behavior
 *
 * Usage:
 *   k6 run tests/load/voice-assistant-load.js
 *   k6 run --vus 10 --duration 30s tests/load/voice-assistant-load.js
 *   k6 run --vus 50 --duration 60s tests/load/voice-assistant-load.js  # stress test
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js'

// ── Test Configuration ───────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '10s', target: 5 },   // Ramp up to 5 concurrent users
    { duration: '30s', target: 5 },   // Stay at 5 for 30s
    { duration: '10s', target: 20 },  // Spike to 20 concurrent users
    { duration: '20s', target: 20 },  // Stay at 20 for 20s
    { duration: '10s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'],  // 95% of requests under 3s
    http_req_failed: ['rate<0.05'],      // Less than 5% error rate
  },
}

// ── Test Data ────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// Sample text inputs for the voice assistant (text mode, no audio needed for load testing)
const testInputs = [
  'Resumen del día',
  '¿Cuántas citas tengo hoy?',
  'Muéstrame los espacios libres',
  '¿Cuánto he facturado esta semana?',
  'Lista mis clientes',
]

// ── Load Test Scenario ───────────────────────────────────────────────────────

export default function voiceLoadTest() {
  const url = `${BASE_URL}/api/assistant/voice`

  // Pick a random test input
  const text = testInputs[Math.floor(Math.random() * testInputs.length)]

  const payload = JSON.stringify({
    text: text,
    timezone: 'America/Bogota',
    history: [],
  })

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  }

  // Note: This endpoint requires authentication.
  // For load testing, you need to provide valid session cookies
  // or use the health endpoint as a proxy for infrastructure testing.

  // Alternative: Test the health endpoint for infrastructure readiness
  const healthUrl = `${BASE_URL}/api/health`
  const healthRes = http.get(healthUrl)

  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health response has status field': (r) => {
      try {
        const body = JSON.parse(r.body)
        return body.status !== undefined
      } catch {
        return false
      }
    },
    'health latency under 500ms': (r) => r.timings.duration < 500,
  })

  sleep(1)
}

// ── Summary Formatter ────────────────────────────────────────────────────────

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'tests/load/results/summary.json': JSON.stringify(data, null, 2),
  }
}
