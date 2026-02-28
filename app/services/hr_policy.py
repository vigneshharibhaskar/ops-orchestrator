"""HR lifecycle policy engine.

Reads a department-to-systems policy document and derives the access
actions (provision/revoke + risk) that should follow an HR event.

The policy document is currently a hardcoded JSON string. To externalize,
replace _load_policy() with a file read, DB fetch, or config service call —
the rest of the module is unchanged.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import List

from app.models.schemas import NewHireEvent, RoleChangeEvent, RiskLevel, TerminationEvent

# ── Policy document (hardcoded — externalize later) ───────────────────────────
#
# Schema: { "<department>": { "systems": [ {"name": "<system>", "note": "..."}, ... ] } }
# "note" is informational only (e.g. "readonly", "org membership") — not parsed.

_POLICY_DOC = """
{
  "engineering": {
    "systems": [
      {"name": "github",   "note": "org membership"},
      {"name": "slack"},
      {"name": "okta"},
      {"name": "vpn"}
    ]
  },
  "finance": {
    "systems": [
      {"name": "okta"},
      {"name": "slack"},
      {"name": "netsuite", "note": "readonly"}
    ]
  },
  "hr": {
    "systems": [
      {"name": "okta"},
      {"name": "slack"},
      {"name": "workday"}
    ]
  },
  "security": {
    "systems": [
      {"name": "okta"},
      {"name": "slack"},
      {"name": "vpn"},
      {"name": "github",   "note": "org membership"}
    ]
  }
}
"""

# ── Provisioning risk per system ──────────────────────────────────────────────
# Revocations and terminations always override to HUMAN_ONLY regardless of this map.

_SYSTEM_RISK: dict[str, RiskLevel] = {
    "github":   RiskLevel.HIGH,    # org membership changes
    "vpn":      RiskLevel.HIGH,    # network access
    "okta":     RiskLevel.MEDIUM,
    "slack":    RiskLevel.MEDIUM,
    "netsuite": RiskLevel.MEDIUM,
    "workday":  RiskLevel.MEDIUM,
}


# ── Policy loading ────────────────────────────────────────────────────────────


def _load_policy() -> dict[str, list[str]]:
    """Parse _POLICY_DOC into {dept_lower: [system_name, ...]}."""
    raw = json.loads(_POLICY_DOC)
    return {
        dept.lower(): [s["name"] for s in cfg["systems"]]
        for dept, cfg in raw.items()
    }


_POLICY: dict[str, list[str]] = _load_policy()


# ── Output type ───────────────────────────────────────────────────────────────


@dataclass
class AccessAction:
    system: str
    action: str       # "provision" | "revoke"
    risk: RiskLevel
    reason: str


# ── Policy engine ─────────────────────────────────────────────────────────────


def _provision_risk(system: str) -> RiskLevel:
    return _SYSTEM_RISK.get(system, RiskLevel.MEDIUM)


def reason_about_access(
    event: NewHireEvent | RoleChangeEvent | TerminationEvent,
) -> List[AccessAction]:
    """Derive access actions and risk classifications from an HR lifecycle event.

    Rules applied (in order of precedence):
    - Termination      → revoke all known systems, all HUMAN_ONLY
    - Revocation       → any system being removed from an employee, HUMAN_ONLY
    - VPN / GitHub     → provisioning these systems is HIGH
    - Everything else  → provisioning is MEDIUM
    """
    if isinstance(event, NewHireEvent):
        systems = _POLICY.get(event.department.lower(), [])
        return [
            AccessAction(
                system=sys,
                action="provision",
                risk=_provision_risk(sys),
                reason=(
                    f"New hire {event.email} joining {event.department} "
                    f"on {event.start_date} — {sys} required by dept policy"
                ),
            )
            for sys in systems
        ]

    if isinstance(event, RoleChangeEvent):
        old = set(_POLICY.get(event.old_department.lower(), []))
        new = set(_POLICY.get(event.new_department.lower(), []))
        actions: List[AccessAction] = []

        # Removals first (sorted for deterministic ordering)
        for sys in sorted(old - new):
            actions.append(AccessAction(
                system=sys,
                action="revoke",
                risk=RiskLevel.HUMAN_ONLY,
                reason=(
                    f"{event.email} moving {event.old_department} → "
                    f"{event.new_department} — {sys} not in new dept policy"
                ),
            ))

        # Then additions
        for sys in sorted(new - old):
            actions.append(AccessAction(
                system=sys,
                action="provision",
                risk=_provision_risk(sys),
                reason=(
                    f"{event.email} joining {event.new_department} as "
                    f"{event.new_title} — {sys} required by dept policy"
                ),
            ))

        return actions

    # TerminationEvent — revoke across every system known to any department
    all_systems = sorted({s for systems in _POLICY.values() for s in systems})
    return [
        AccessAction(
            system=sys,
            action="revoke",
            risk=RiskLevel.HUMAN_ONLY,
            reason=(
                f"Termination: revoke all access for {event.email} "
                f"(last day {event.last_day})"
            ),
        )
        for sys in all_systems
    ]
