"""Pytest bootstrap for the evals package.

Adds the evals directory to sys.path so the local ``groq_rotator`` module is
importable without installing the package, and exposes the fixtures path.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_EVALS_DIR = Path(__file__).parent
if str(_EVALS_DIR) not in sys.path:
    sys.path.insert(0, str(_EVALS_DIR))


def _load_dotenv() -> None:
    """Best-effort load of the repo-root .env.local into os.environ.

    Keeps "all credentials live in .env" working for pytest without adding a
    python-dotenv dependency. Existing process env always wins (never override).
    """
    for parent in (_EVALS_DIR, *_EVALS_DIR.parents):
        env_file = parent / ".env.local"
        if env_file.is_file():
            for raw in env_file.read_text(encoding="utf-8-sig").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
            return


_load_dotenv()
