"""Mocked Google Workspace tool adapter.

In production, replace each function body with real Admin SDK calls
(e.g. via google-api-python-client against the Directory API).
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime
from typing import Any, Dict


def _result(ok: bool, action: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tool": "google_workspace",
        "action": action,
        "ok": ok,
        "data": data,
        "executed_at": datetime.utcnow().isoformat() + "Z",
        "mock": True,
    }


def create_user(
    email: str,
    first_name: str = "",
    last_name: str = "",
    department: str = "",
    org_unit_path: str = "/",
    **kwargs: Any,
) -> Dict[str, Any]:
    """Create a Google Workspace user account (mocked)."""
    numeric_id = str(random.randint(10**17, 10**18 - 1))
    derived_org = f"/{department.title()}" if department else org_unit_path
    return _result(
        ok=True,
        action="create_user",
        data={
            "kind": "admin#directory#user",
            "id": numeric_id,
            "primaryEmail": email,
            "name": {
                "givenName": first_name or email.split("@")[0].split(".")[0].title(),
                "familyName": last_name or email.split("@")[0].split(".")[-1].title(),
                "fullName": f"{first_name} {last_name}".strip() or email.split("@")[0],
            },
            "orgUnitPath": derived_org,
            "suspended": False,
            "creationTime": datetime.utcnow().isoformat() + "Z",
            "customerId": f"C{uuid.uuid4().hex[:8]}",
        },
    )


def suspend_user(email: str, **kwargs: Any) -> Dict[str, Any]:
    """Suspend a Google Workspace user account (mocked)."""
    numeric_id = str(random.randint(10**17, 10**18 - 1))
    return _result(
        ok=True,
        action="suspend_user",
        data={
            "kind": "admin#directory#user",
            "id": numeric_id,
            "primaryEmail": email,
            "suspended": True,
            "suspensionReason": "ADMIN",
            "lastLoginTime": datetime.utcnow().isoformat() + "Z",
        },
    )


# ── Dispatch table ─────────────────────────────────────────────────────────────

_DISPATCH: Dict[str, Any] = {
    "create_user": create_user,
    "suspend_user": suspend_user,
}


def execute(action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Generic dispatch: route action name to the correct function."""
    fn = _DISPATCH.get(action)
    if fn is None:
        return _result(
            ok=False,
            action=action,
            data={"error": f"Unknown Google Workspace action: {action}"},
        )
    return fn(**args)
