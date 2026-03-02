"""Drift detection service.

Compares the provisioning record (what was actually granted/revoked via
OpsRequests) against the HR policy (what each department should have).

Three drift types:
  unexpected  — user has access with no policy justification for their dept  (HIGH)
  missing     — policy requires access but no grant record exists            (MEDIUM)
  stale       — access exists and policy matches, but grant is >90 days old  (LOW)

All computation is pure DB-derived — no external state store needed.
HR event OpsRequest payloads store email + system + department, giving us
enough data to reconstruct both expected and actual access from OpsRequests.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Set

from sqlalchemy.orm import Session

from app.models.orm import OpsRequest, RequestStatus
from app.services.hr_policy import _POLICY  # dept → [system, ...]

STALE_DAYS = 90

_GRANT_WORDS = {"provision", "grant", "add", "create", "onboard", "invite"}
_REVOKE_WORDS = {"revoke", "remove", "deactivate", "offboard", "suspend"}


# ── DriftItem ─────────────────────────────────────────────────────────────────


@dataclass
class DriftItem:
    email: str
    system: str
    drift_type: str          # "unexpected" | "missing" | "stale"
    severity: str            # "HIGH" | "MEDIUM" | "LOW"
    detail: str
    last_grant_id: Optional[str]
    last_grant_date: Optional[str]  # ISO string
    days_since_grant: Optional[int]
    department: Optional[str]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _is_grant(intent: str) -> bool:
    lower = intent.lower()
    return any(w in lower for w in _GRANT_WORDS) and not _is_revoke(intent)


def _is_revoke(intent: str) -> bool:
    lower = intent.lower()
    return any(w in lower for w in _REVOKE_WORDS)


def _extract_email(req: OpsRequest) -> str:
    return (req.payload or {}).get("email") or (req.payload or {}).get("user_email", "")


def _extract_system(req: OpsRequest) -> str:
    payload = req.payload or {}
    if "system" in payload:
        return payload["system"]
    # Ad-hoc requests: derive from first successful execution_result.tool_name
    for r in (req.execution_results or []):
        if r.get("ok") and r.get("tool_name"):
            return r["tool_name"]
    return ""


# ── Core scan ─────────────────────────────────────────────────────────────────


def _build_actual_access(
    reqs: List[OpsRequest],
) -> Dict[str, Dict[str, OpsRequest]]:
    """Build email → {system → OpsRequest} representing net current access.

    Processes in created_at ASC order: grants add entries, revokes remove them.
    auto_revoked requests are already reflected as revokes via the revoke
    OpsRequest (intent=auto_revoke_expired_access) — no special handling needed.
    """
    actual: Dict[str, Dict[str, OpsRequest]] = {}
    for req in reqs:
        email = _extract_email(req)
        system = _extract_system(req)
        if not email or not system:
            continue
        if email not in actual:
            actual[email] = {}
        if _is_grant(req.intent):
            actual[email][system] = req
        elif _is_revoke(req.intent):
            actual[email].pop(system, None)
    return actual


def _build_email_to_dept(reqs: List[OpsRequest]) -> Dict[str, str]:
    """Derive email → current_department from HR event OpsRequest payloads.

    new_hire events have payload["department"].
    role_change events have payload["new_department"].
    Last assignment (by created_at ASC) wins.
    """
    dept_map: Dict[str, str] = {}
    for req in reqs:
        payload = req.payload or {}
        email = _extract_email(req)
        if not email:
            continue
        dept = payload.get("department") or payload.get("new_department")
        if dept:
            dept_map[email] = dept.lower()
    return dept_map


def scan(db: Session, email: Optional[str] = None) -> List[DriftItem]:
    """Compute drift items for one user (if email given) or all users."""
    now = datetime.utcnow()

    # Fetch all COMPLETED OpsRequests sorted oldest-first for replay
    query = (
        db.query(OpsRequest)
        .filter(OpsRequest.status == RequestStatus.COMPLETED)
        .order_by(OpsRequest.created_at)
    )
    if email:
        # Fast-path: only need requests relevant to this email
        # Still fetch all (JSON filtering in Python; SQLite has no JSON path index)
        pass
    all_reqs = query.all()

    actual_access = _build_actual_access(all_reqs)
    email_to_dept = _build_email_to_dept(all_reqs)

    # Filter to target email if specified
    emails_to_scan: Set[str] = set(actual_access.keys()) | set(email_to_dept.keys())
    if email:
        emails_to_scan = {email}

    items: List[DriftItem] = []

    for user_email in sorted(emails_to_scan):
        dept = email_to_dept.get(user_email)
        expected: Set[str] = set(_POLICY.get(dept, [])) if dept else set()
        actual: Dict[str, OpsRequest] = actual_access.get(user_email, {})
        actual_systems: Set[str] = set(actual.keys())

        # ── Unexpected ────────────────────────────────────────────────────────
        for sys in sorted(actual_systems - expected):
            grant_req = actual[sys]
            days = (now - grant_req.created_at).days
            items.append(DriftItem(
                email=user_email,
                system=sys,
                drift_type="unexpected",
                severity="HIGH",
                detail=(
                    f"{sys} was granted but is not required by "
                    f"{dept} policy" if dept else f"{sys} has no policy justification"
                ),
                last_grant_id=grant_req.id,
                last_grant_date=grant_req.created_at.isoformat(),
                days_since_grant=days,
                department=dept,
            ))

        # ── Missing ───────────────────────────────────────────────────────────
        if dept:
            for sys in sorted(expected - actual_systems):
                items.append(DriftItem(
                    email=user_email,
                    system=sys,
                    drift_type="missing",
                    severity="MEDIUM",
                    detail=f"{sys} is required by {dept} policy but no grant record exists",
                    last_grant_id=None,
                    last_grant_date=None,
                    days_since_grant=None,
                    department=dept,
                ))

        # ── Stale ─────────────────────────────────────────────────────────────
        check_for_stale = actual_systems & expected if dept else actual_systems
        for sys in sorted(check_for_stale):
            grant_req = actual[sys]
            days = (now - grant_req.created_at).days
            if days > STALE_DAYS:
                items.append(DriftItem(
                    email=user_email,
                    system=sys,
                    drift_type="stale",
                    severity="LOW",
                    detail=(
                        f"{sys} access granted {days} days ago "
                        f"— verify still needed"
                    ),
                    last_grant_id=grant_req.id,
                    last_grant_date=grant_req.created_at.isoformat(),
                    days_since_grant=days,
                    department=dept,
                ))

    return items
