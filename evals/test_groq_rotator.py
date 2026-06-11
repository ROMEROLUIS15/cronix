"""Unit tests for the key-rotation logic of GroqRotatorLLM.

These are fully offline and deterministic: the Groq client is monkeypatched
with a fake, ``time.sleep`` is stubbed, and no network call is ever made. They
verify rotation/backoff behaviour without needing real API keys.
"""

from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("groq")
pytest.importorskip("deepeval")

import groq_rotator as gr  # noqa: E402


class _FakeRateLimit(Exception):
    status_code = 429


class _FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str) -> None:
        self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content: str) -> None:
        self.choices = [_FakeChoice(content)]


class _FakeClient:
    """Records which API key produced each call; fails N times then succeeds."""

    instances: list["_FakeClient"] = []

    def __init__(self, api_key: str, fail_times: int) -> None:
        self.api_key = api_key
        self._remaining_failures = fail_times
        self.completions_called = 0
        _FakeClient.instances.append(self)

        rotator = self

        class _Completions:
            def create(self, **_: Any) -> _FakeResponse:
                rotator.completions_called += 1
                if rotator._remaining_failures > 0:
                    rotator._remaining_failures -= 1
                    raise _FakeRateLimit("429 rate limit reached")
                return _FakeResponse(f"ok:{rotator.api_key}")

        class _Chat:
            completions = _Completions()

        self.chat = _Chat()


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gr.time, "sleep", lambda _seconds: None)


def _install_client(monkeypatch: pytest.MonkeyPatch, fail_times: int) -> None:
    _FakeClient.instances = []
    monkeypatch.setattr(gr, "RateLimitError", _FakeRateLimit)
    monkeypatch.setattr(gr, "Groq", lambda api_key: _FakeClient(api_key, fail_times))


def test_rotates_keys_on_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEYS", "k1, k2, k3")
    # first two clients hit a 429, third succeeds
    _install_client(monkeypatch, fail_times=0)
    # override so only the first two created clients fail
    created: list[_FakeClient] = []

    def _factory(api_key: str) -> _FakeClient:
        fail = 1 if len(created) < 2 else 0
        client = _FakeClient(api_key, fail)
        created.append(client)
        return client

    monkeypatch.setattr(gr, "Groq", _factory)

    judge = gr.GroqRotatorLLM(max_retries=6)
    result = judge.generate("ping")

    assert result == "ok:k3"
    assert [c.api_key for c in created] == ["k1", "k2", "k3"]


def test_raises_when_keys_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Clear every var in the pool — conftest may have loaded LLM_API_KEY from .env.local.
    monkeypatch.setenv("GROQ_API_KEYS", "   ")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setattr(gr, "Groq", lambda api_key: _FakeClient(api_key, 0))
    with pytest.raises(ValueError):
        gr.GroqRotatorLLM()


def test_exhausts_after_max_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEYS", "k1,k2")
    _install_client(monkeypatch, fail_times=99)  # every call rate-limits

    judge = gr.GroqRotatorLLM(max_retries=3)
    with pytest.raises(RuntimeError, match="rotation exhausted"):
        judge.generate("ping")


def test_load_api_keys_dedupes_and_trims(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEYS", " k1 , k2,k1 ,, k3 ")
    assert gr.load_api_keys() == ["k1", "k2", "k3"]
