# Evals — DeepEval + Groq (free tier)

LLM-as-judge evaluation of the Voice Agent using [DeepEval](https://github.com/confident-ai/deepeval),
judged by Groq's `llama-3.3-70b-versatile` with **round-robin API-key rotation**
to stay under the free-tier rate limits.

## Layout

| File | Purpose |
|---|---|
| `groq_rotator.py` | `GroqRotatorLLM` — DeepEval judge with key rotation + 429 backoff |
| `fixtures/agent_conversations.json` | Static conversation cases (no live agent / no DB) |
| `test_agent_evals.py` | `AnswerRelevancyMetric` + `HallucinationMetric` over the fixtures |
| `test_groq_rotator.py` | Offline unit tests for the rotation/backoff logic (no network) |
| `conftest.py` | Puts this dir on `sys.path` so `groq_rotator` imports |

## Setup

```bash
cd evals
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# macOS/Linux:         source .venv/bin/activate
pip install -r requirements.txt
```

### Groq keys

The judge reads the first non-empty of, in order: **`GROQ_API_KEYS`** then
**`LLM_API_KEY`** (the repo's existing Groq pool — a comma-separated list of
`gsk_` keys already used by `GroqProvider`). `conftest.py` auto-loads the
repo-root `.env.local`, so **if your keys are already in `.env.local` you need
no extra setup**.

To override explicitly:

```bash
# PowerShell
$env:GROQ_API_KEYS = "gsk_aaa,gsk_bbb,gsk_ccc"
# bash
export GROQ_API_KEYS="gsk_aaa,gsk_bbb,gsk_ccc"
```

## Running

```bash
# Offline rotation unit tests — no keys, no network needed:
pytest test_groq_rotator.py -v

# Full LLM-judge evals (requires GROQ_API_KEYS):
pytest test_agent_evals.py -v
```

Without `GROQ_API_KEYS`, `test_agent_evals.py` is **skipped** (not failed), so CI
without secrets stays green.

## Determinism & isolation

- Inputs are static fixtures — never the live agent or any database.
- No DB writes or external side-effects beyond the judge call.
- Judge runs at `temperature=0` for maximal repeatability.
- `HallucinationMetric`: lower score is better; the test passes when
  `score <= threshold` (0.3 here).

## Key rotation

`GroqRotatorLLM` reads `GROQ_API_KEYS`, cycles round-robin, and on a `429` /
"rate limit" it rotates to the next key and retries with exponential backoff
(1s → 2s → … capped at 30s), up to `max_retries`. Exhausting all retries raises
`RuntimeError`.
