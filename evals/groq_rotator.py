"""GroqRotatorLLM — a DeepEval judge backed by Groq with API-key rotation.

Groq's free tier enforces per-key rate limits (requests/min and tokens/min).
To run a full evaluation suite without tripping 429s, this judge reads a
comma-separated list of keys from ``GROQ_API_KEYS`` and rotates round-robin to
the next key whenever a rate-limit is hit, applying exponential backoff.

The model is ``llama-3.3-70b-versatile`` at ``temperature=0`` so the judge is
as deterministic as the provider allows.
"""

from __future__ import annotations

import os
import time
from itertools import cycle
from typing import Any, Iterator

from deepeval.models.base_model import DeepEvalBaseLLM
from groq import Groq, RateLimitError

DEFAULT_MODEL = "llama-3.3-70b-versatile"
_MAX_BACKOFF_SECONDS = 30.0


#: Env vars scanned for the Groq key pool, in priority order. ``GROQ_API_KEYS``
#: is the documented override; ``LLM_API_KEY`` is the repo's existing Groq pool
#: (a comma-separated list of gsk_ keys already consumed by GroqProvider).
KEY_ENV_VARS = ("GROQ_API_KEYS", "LLM_API_KEY")


def load_api_keys() -> list[str]:
    """Parse the Groq key pool into a clean, de-duplicated key list.

    Reads the first non-empty var in :data:`KEY_ENV_VARS`, splitting on commas.
    """
    raw = ""
    for name in KEY_ENV_VARS:
        candidate = os.environ.get(name, "").strip()
        if candidate:
            raw = candidate
            break
    seen: set[str] = set()
    keys: list[str] = []
    for token in raw.split(","):
        key = token.strip()
        if key and key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def _is_rate_limit(error: Exception) -> bool:
    """True when an arbitrary exception is, in substance, a 429 rate-limit."""
    if isinstance(error, RateLimitError):
        return True
    if getattr(error, "status_code", None) == 429:
        return True
    text = str(error).lower()
    return "rate limit" in text or "429" in text


class GroqRotatorLLM(DeepEvalBaseLLM):
    """DeepEval-compatible LLM judge with round-robin Groq key rotation."""

    def __init__(self, model: str = DEFAULT_MODEL, max_retries: int = 6) -> None:
        keys = load_api_keys()
        if not keys:
            raise ValueError(
                "No Groq keys found — set GROQ_API_KEYS (or LLM_API_KEY) to a "
                "comma-separated list of Groq API keys"
            )
        self.model = model
        self.max_retries = max_retries
        self._keys = keys
        self._cursor: Iterator[str] = cycle(keys)
        self._current_key = next(self._cursor)
        self._client = Groq(api_key=self._current_key)

    # ── DeepEvalBaseLLM contract ────────────────────────────────────────────
    def load_model(self) -> "GroqRotatorLLM":
        return self

    def generate(self, prompt: str, *args: Any, **kwargs: Any) -> str:
        return self._complete(prompt)

    async def a_generate(self, prompt: str, *args: Any, **kwargs: Any) -> str:
        return self._complete(prompt)

    def get_model_name(self) -> str:
        return f"groq:{self.model}"

    # ── Internals ───────────────────────────────────────────────────────────
    def _rotate(self) -> None:
        self._current_key = next(self._cursor)
        self._client = Groq(api_key=self._current_key)

    def _complete(self, prompt: str) -> str:
        delay = 1.0
        last_error: Exception | None = None
        for _ in range(self.max_retries):
            try:
                response = self._client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                )
                if not response.choices:
                    return ""
                content = response.choices[0].message.content
                return content if content is not None else ""
            except Exception as error:  # noqa: BLE001 — rotate only on rate-limits
                if not _is_rate_limit(error):
                    raise
                last_error = error
                self._rotate()
                time.sleep(delay)
                delay = min(delay * 2, _MAX_BACKOFF_SECONDS)
        raise RuntimeError(
            f"Groq key rotation exhausted after {self.max_retries} attempts"
        ) from last_error
