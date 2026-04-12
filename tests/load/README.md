# k6 Load Testing — Cronix

## Setup

1. Install k6: `brew install k6` (macOS) or [official docs](https://k6.io/docs/getting-started/installation/)
2. Set `BASE_URL` env var or use default (`http://localhost:3000`)

## Running Tests

### Quick smoke test
```bash
k6 run tests/load/voice-assistant-load.js
```

### Stress test (20 concurrent users for 60s)
```bash
k6 run --vus 20 --duration 60s tests/load/voice-assistant-load.js
```

### Custom scenario
```bash
k6 run \
  --stage 10s:5 \
  --stage 30s:20 \
  --stage 10s:50 \
  --stage 10s:0 \
  tests/load/voice-assistant-load.js
```

## Thresholds

| Metric | Target | Purpose |
|--------|--------|---------|
| p95 latency | < 3000ms | Ensures AI voice requests complete in reasonable time |
| Error rate | < 5% | Prevents systemic failures under load |

## Results

Results are written to `tests/load/results/summary.json` after each run.

## What This Tests

- **Health endpoint**: Infrastructure readiness under concurrent load
- **Rate limiting**: Verifies distributed rate limits hold under burst traffic
- **Memory pressure**: Serverless function memory limits
- **Connection pooling**: Database connection behavior under concurrent requests

## Future: Voice Assistant Full Flow

To test the full voice assistant flow (STT → LLM → TTS), you need:
1. Valid session cookies (authenticated user)
2. Audio files or text inputs that trigger the full AI pipeline
3. Token quota monitoring

Add a `voice-assistant-full.js` scenario when ready with auth setup.
