"""DeepEval suite for the Voice Agent, judged by Groq (key-rotating).

Tests are deterministic and isolated:
  * Inputs come from static fixtures (``fixtures/agent_conversations.json``),
    never from the live agent or any database.
  * No DB / network side-effects beyond the LLM-judge call.
  * Judge runs at temperature=0 for maximal repeatability.

The whole module is skipped when ``GROQ_API_KEYS`` is absent, so CI without
secrets stays green and the suite never blocks on missing credentials.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

FIXTURES = Path(__file__).parent / "fixtures" / "agent_conversations.json"

pytestmark = pytest.mark.skipif(
    not (os.environ.get("GROQ_API_KEYS") or os.environ.get("LLM_API_KEY")),
    reason="No Groq keys (GROQ_API_KEYS / LLM_API_KEY) — skipping live LLM-judge evals",
)


def _load_cases() -> list[dict[str, Any]]:
    with FIXTURES.open(encoding="utf-8") as handle:
        return json.load(handle)


def _case_id(case: dict[str, Any]) -> str:
    return str(case["name"])


@pytest.fixture(scope="session")
def judge():  # type: ignore[no-untyped-def]
    from groq_rotator import GroqRotatorLLM

    return GroqRotatorLLM()


@pytest.mark.parametrize("case", _load_cases(), ids=_case_id)
def test_answer_relevancy(case: dict[str, Any], judge: Any) -> None:
    from deepeval import assert_test
    from deepeval.metrics import AnswerRelevancyMetric
    from deepeval.test_case import LLMTestCase

    test_case = LLMTestCase(
        input=case["input"],
        actual_output=case["actual_output"],
    )
    metric = AnswerRelevancyMetric(threshold=0.7, model=judge, include_reason=False)
    assert_test(test_case, [metric])


@pytest.mark.parametrize("case", _load_cases(), ids=_case_id)
def test_no_hallucination(case: dict[str, Any], judge: Any) -> None:
    from deepeval import assert_test
    from deepeval.metrics import HallucinationMetric
    from deepeval.test_case import LLMTestCase

    test_case = LLMTestCase(
        input=case["input"],
        actual_output=case["actual_output"],
        context=case["context"],
    )
    # HallucinationMetric: lower is better — passes when score <= threshold.
    metric = HallucinationMetric(threshold=0.3, model=judge, include_reason=False)
    assert_test(test_case, [metric])
