"""Deterministic rule-based risk engine.

Rules (in priority order — highest match wins per step):
  HUMAN_ONLY : revocation/offboarding actions
               access grants/modifies targeting prod/infra/security environments
               access grants/modifies using admin/owner/org_wide permissions
  HIGH       : any other access grant or org membership add
               prod keyword in non-access step args
  MEDIUM     : create PR, create repo, invite to channel
  LOW        : notifications, read-only actions, send message

Overall risk = max(step risks). If any step is HIGH or HUMAN_ONLY,
needs_human_approval = True.  HUMAN_ONLY steps never auto-execute.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List

from app.models.schemas import EvidenceItem, PolicyReference, RiskLevel, TaskStep

POLICY_VERSION = "1.0.0"

# ── Rule definitions ──────────────────────────────────────────────────────────

_HUMAN_ONLY_ACTIONS = frozenset({
    "revoke_access", "remove_from_org", "offboard_user",
    "delete_user", "disable_account", "terminate",
})

_HIGH_ACTIONS = frozenset({
    "add_to_org", "grant_access", "add_collaborator",
    "merge_pr", "deploy", "promote_to_prod",
    "create_user", "assign_role",
})

_MEDIUM_ACTIONS = frozenset({
    "create_pr", "create_repo", "create_branch",
    "invite_to_channel", "create_team",
})

_PROD_PATTERN = re.compile(r"\bprod(uction)?\b", re.IGNORECASE)

# Broader sensitive-environment pattern — prod + infra + security.
# Used for HUMAN_ONLY escalation on access steps AND for keyword evidence.
_SENSITIVE_ENV_PATTERN = re.compile(
    r"\b(prod(uction)?|infra(structure)?|security)\b", re.IGNORECASE
)

# Permissions that escalate access actions to HUMAN_ONLY.
_PRIVILEGED_PERMISSIONS = frozenset({"admin", "owner", "org_wide"})

# ── Policy catalog ────────────────────────────────────────────────────────────

_POLICY_CATALOG: Dict[str, PolicyReference] = {
    "HUMAN_ONLY_001": PolicyReference(
        id="HUMAN_ONLY_001",
        title="Human-Only Revocation Policy",
        severity=RiskLevel.HUMAN_ONLY,
    ),
    "ACCESS_CONTROL_001": PolicyReference(
        id="ACCESS_CONTROL_001",
        title="Org Access Grant Policy",
        severity=RiskLevel.HIGH,
    ),
    "PROD_SAFEGUARD_001": PolicyReference(
        id="PROD_SAFEGUARD_001",
        title="Production Environment Safeguard",
        severity=RiskLevel.HIGH,
    ),
    "REPO_POLICY_001": PolicyReference(
        id="REPO_POLICY_001",
        title="Repository Modification Policy",
        severity=RiskLevel.MEDIUM,
    ),
    "PROD_ACCESS_HUMAN_ONLY_001": PolicyReference(
        id="PROD_ACCESS_HUMAN_ONLY_001",
        title="Production/Infra Access Human-Only Gate",
        severity=RiskLevel.HUMAN_ONLY,
    ),
    "PRIVILEGED_PERM_HUMAN_ONLY_001": PolicyReference(
        id="PRIVILEGED_PERM_HUMAN_ONLY_001",
        title="Privileged Permission Human-Only Gate",
        severity=RiskLevel.HUMAN_ONLY,
    ),
}

# Confidence per risk level: deterministic rule-sets are high confidence;
# LOW is a catch-all so slightly less certain about plan completeness.
_CONFIDENCE_BY_RISK = {
    RiskLevel.HUMAN_ONLY: 0.95,
    RiskLevel.HIGH: 0.90,
    RiskLevel.MEDIUM: 0.85,
    RiskLevel.LOW: 0.80,
}

_RISK_ORDER = {
    RiskLevel.LOW: 0,
    RiskLevel.MEDIUM: 1,
    RiskLevel.HIGH: 2,
    RiskLevel.HUMAN_ONLY: 3,
}

# Arg key categories used to build field/permission/target evidence items.
_PERMISSION_KEYS = frozenset({"permission", "role"})
_TARGET_KEYS = frozenset({"org", "target", "env", "environment"})


def _score_step(
    step: TaskStep,
) -> tuple[RiskLevel, str, str, List[EvidenceItem]]:
    """Return (risk_level, reason, policy_id, evidence_items) for one step."""
    action = step.action.lower()
    evidence: List[EvidenceItem] = []

    # The matched action is always primary evidence.
    evidence.append(EvidenceItem(type="tool", value=step.action))

    # Scan args for permission/target/keyword evidence regardless of which
    # policy ultimately fires — gives approvers full context.
    # Keyword evidence uses the broader _SENSITIVE_ENV_PATTERN (prod/infra/security).
    for arg_key, arg_val in step.args.items():
        arg_str = str(arg_val)
        key_lower = arg_key.lower()

        if key_lower in _PERMISSION_KEYS:
            evidence.append(EvidenceItem(type="permission", field=arg_key, value=arg_str))
        elif key_lower in _TARGET_KEYS:
            evidence.append(EvidenceItem(type="target", field=arg_key, value=arg_str))

        m = _SENSITIVE_ENV_PATTERN.search(arg_str)
        if m:
            evidence.append(EvidenceItem(
                type="keyword",
                field=arg_key,
                value=m.group(0),
                snippet=arg_str,
            ))

    # Derived signals used in risk classification below.
    has_sensitive_env = any(e.type == "keyword" for e in evidence)
    has_privileged_perm = any(
        e.type == "permission" and e.value and e.value.lower() in _PRIVILEGED_PERMISSIONS
        for e in evidence
    )
    # Narrower prod-only check — keeps existing HIGH rule for non-access steps.
    has_prod_keyword = any(
        e.type == "keyword" and e.value and _PROD_PATTERN.search(e.value)
        for e in evidence
    )

    if action in _HUMAN_ONLY_ACTIONS:
        return (
            RiskLevel.HUMAN_ONLY,
            f"Action '{step.action}' requires mandatory human review",
            "HUMAN_ONLY_001",
            evidence,
        )

    if action in _HIGH_ACTIONS:
        # Escalate to HUMAN_ONLY when targeting sensitive environments or
        # using privileged permissions — no admin can bypass this gate.
        if has_privileged_perm:
            perm_val = next(
                (e.value for e in evidence
                 if e.type == "permission" and e.value
                 and e.value.lower() in _PRIVILEGED_PERMISSIONS),
                "privileged",
            )
            return (
                RiskLevel.HUMAN_ONLY,
                f"Action '{step.action}' uses privileged permission '{perm_val}'"
                " — mandatory human review required",
                "PRIVILEGED_PERM_HUMAN_ONLY_001",
                evidence,
            )
        if has_sensitive_env:
            env_val = next(
                (e.value for e in evidence if e.type == "keyword"), "sensitive"
            )
            return (
                RiskLevel.HUMAN_ONLY,
                f"Action '{step.action}' targets sensitive environment '{env_val}'"
                " — mandatory human review required",
                "PROD_ACCESS_HUMAN_ONLY_001",
                evidence,
            )
        return (
            RiskLevel.HIGH,
            f"Action '{step.action}' grants or modifies access — requires approval",
            "ACCESS_CONTROL_001",
            evidence,
        )

    if has_prod_keyword:
        return (
            RiskLevel.HIGH,
            "Step args reference production environment — requires approval",
            "PROD_SAFEGUARD_001",
            evidence,
        )

    if action in _MEDIUM_ACTIONS:
        return (
            RiskLevel.MEDIUM,
            f"Action '{step.action}' modifies repository or team structure",
            "REPO_POLICY_001",
            evidence,
        )

    return RiskLevel.LOW, f"Action '{step.action}' is informational/low impact", "", evidence


@dataclass
class RiskAssessment:
    overall_risk: RiskLevel
    score: float                     # 0.0–1.0 for downstream logging
    flags: List[str]
    needs_human_approval: bool
    annotated_steps: List[TaskStep]
    summary: str
    policy_references: List[PolicyReference] = field(default_factory=list)
    evidence: List[EvidenceItem] = field(default_factory=list)
    confidence: float = 1.0


def assess(steps: List[TaskStep]) -> RiskAssessment:
    """Run risk assessment across all task steps; return annotated result."""
    flags: List[str] = []
    annotated: List[TaskStep] = []
    max_risk = RiskLevel.LOW
    seen_policy_ids: set[str] = set()
    all_policy_references: List[PolicyReference] = []
    all_evidence: List[EvidenceItem] = []
    min_confidence = 1.0

    for step in steps:
        risk, reason, policy_id, evidence = _score_step(step)

        # Escalate overall risk
        if _RISK_ORDER[risk] > _RISK_ORDER[max_risk]:
            max_risk = risk

        # Track minimum step confidence for plan-level confidence
        step_confidence = _CONFIDENCE_BY_RISK[risk]
        if step_confidence < min_confidence:
            min_confidence = step_confidence

        # Deduplicate policy references (one entry per triggered policy)
        if policy_id and policy_id not in seen_policy_ids:
            seen_policy_ids.add(policy_id)
            all_policy_references.append(_POLICY_CATALOG[policy_id])

        all_evidence.extend(evidence)

        requires_approval = risk in (RiskLevel.HIGH, RiskLevel.HUMAN_ONLY)
        if requires_approval:
            flags.append(reason)

        annotated.append(step.model_copy(update={
            "risk": risk,
            "requires_approval": requires_approval,
            "reason": reason,
        }))

    needs_approval = max_risk in (RiskLevel.HIGH, RiskLevel.HUMAN_ONLY)

    score_map = {
        RiskLevel.LOW: 0.1,
        RiskLevel.MEDIUM: 0.4,
        RiskLevel.HIGH: 0.8,
        RiskLevel.HUMAN_ONLY: 1.0,
    }

    summary = (
        f"Overall risk: {max_risk}. "
        + (f"Flagged steps: {'; '.join(flags)}" if flags else "No high-risk steps detected.")
    )

    return RiskAssessment(
        overall_risk=max_risk,
        score=score_map[max_risk],
        flags=flags,
        needs_human_approval=needs_approval,
        annotated_steps=annotated,
        summary=summary,
        policy_references=all_policy_references,
        evidence=all_evidence,
        confidence=round(min_confidence, 2),
    )
