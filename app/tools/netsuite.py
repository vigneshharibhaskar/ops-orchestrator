"""Mocked NetSuite tool adapter.

In production, replace each function body with real NetSuite API calls
(e.g. via SuiteScript REST API or the NetSuite SDK).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict


def _result(ok: bool, action: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tool": "netsuite",
        "action": action,
        "ok": ok,
        "data": data,
        "executed_at": datetime.utcnow().isoformat() + "Z",
        "mock": True,
    }


def provision_user(email: str, role: str = "employee_center", **kwargs: Any) -> Dict[str, Any]:
    """Create a NetSuite employee record and grant portal access (mocked)."""
    internal_id = str(uuid.uuid4().int % 900000 + 100000)
    return _result(
        ok=True,
        action="provision_user",
        data={
            "internal_id": internal_id,
            "email": email,
            "role": role,
            "status": "active",
            "url": f"https://mock.netsuite.com/app/common/entity/employee.nl?id={internal_id}",
        },
    )


def deactivate_user(email: str, **kwargs: Any) -> Dict[str, Any]:
    """Revoke NetSuite access and mark employee record inactive (mocked)."""
    internal_id = str(uuid.uuid4().int % 900000 + 100000)
    return _result(
        ok=True,
        action="deactivate_user",
        data={
            "internal_id": internal_id,
            "email": email,
            "status": "inactive",
            "deactivated": datetime.utcnow().isoformat() + "Z",
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
            data={"error": f"Unknown NetSuite action: {action}"},
        )
    return fn(**args)
