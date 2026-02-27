"""Prompt-injection detector.

Scans request intent + payload for instruction-override patterns.
Returns a list of human-readable safety flags; empty list = clean.

To add a new pattern:
  1. Append a (regex, flag_name) tuple to _PATTERNS
  2. Bump POLICY_VERSION in app/services/risk.py
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

# (regex_pattern, flag_name) — ordered most-specific first
_PATTERNS: List[tuple[str, str]] = [
    (
        r"\bignore\b.{0,40}\b(policy|policies|rules|instructions|restrictions|guidelines)\b",
        "injection:ignore_policy",
    ),
    (
        r"\bignore\b.{0,20}\b(previous|all|your)\b",
        "injection:ignore_directives",
    ),
    (
        r"\b(disregard|forget|bypass|override)\b.{0,30}\b(policy|policies|rules|instructions|restrictions)\b",
        "injection:bypass_policy",
    ),
    (
        r"\bjailbreak\b",
        "injection:jailbreak",
    ),
    (
        r"\bpretend\s+(you\s+are|to\s+be)\b",
        "injection:role_override",
    ),
    (
        r"\bact\s+as\s+if\s+you\s+(are|have|don'?t)\b",
        "injection:role_override",
    ),
    (
        r"\byou\s+have\s+no\s+(restrictions|rules|policies|limits)\b",
        "injection:unrestricted_claim",
    ),
    (
        r"\bsystem\s+prompt\b",
        "injection:system_prompt_reference",
    ),
    (
        r"\bignore\s+your\s+training\b",
        "injection:training_override",
    ),
    (
        r"\bnew\s+instructions?\s*:",
        "injection:instruction_injection",
    ),
]

_COMPILED = [
    (re.compile(pat, re.IGNORECASE | re.DOTALL), flag)
    for pat, flag in _PATTERNS
]


def scan(intent: str, payload: Dict[str, Any]) -> List[str]:
    """Return injection flags found in intent + all payload string values.

    Empty list means no injection detected.
    """
    texts = [intent] + [str(v) for v in payload.values()]
    full_text = " ".join(texts)

    found: List[str] = []
    for pattern, flag in _COMPILED:
        if pattern.search(full_text) and flag not in found:
            found.append(flag)
    return found
