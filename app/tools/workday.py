"""Mocked Workday tool adapter.

In production, replace each function body with real Workday API calls
(e.g. via Workday REST API or SOAP/WSDL integration).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict


def _result(ok: bool, action: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tool": "workday",
        "action": action,
        "ok": ok,
        "data": data,
        "executed_at": datetime.utcnow().isoformat() + "Z",
        "mock": True,
    }


def provision_user(email: str, department: str = "", **kwargs: Any) -> Dict[str, Any]:
    """Create a Workday worker record and grant system access (mocked)."""
    worker_id = f"WD-{uuid.uuid4().hex[:8].upper()}"
    return _result(
        ok=True,
        action="provision_user",
        data={
            "worker_id": worker_id,
            "email": email,
            "department": department,
            "status": "active",
            "url": f"https://mock.workday.com/workers/{worker_id}",
        },
    )


def deactivate_user(email: str, **kwargs: Any) -> Dict[str, Any]:
    """Terminate a Workday worker record and revoke system access (mocked)."""
    worker_id = f"WD-{uuid.uuid4().hex[:8].upper()}"
    return _result(
        ok=True,
        action="deactivate_user",
        data={
            "worker_id": worker_id,
            "email": email,
            "status": "terminated",
            "terminated": datetime.utcnow().isoformat() + "Z",
        },
    )


# ── Dispatch table ─────────────────────────────────────────────────────────────

_DISPATCH: Dict[str, Any] = {
    "provision_user": provision_user,
    "deactivate_user": deactivate_user,
}


def execute(action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    fn = _DISPATCH.get(action)
    if fn is None:
        return _result(
            ok=False,
            action=action,
            data={"error": f"Unknown Workday action: {action}"},
        )
    return fn(**args)
