"""Mocked Okta tool adapter.

In production, replace each function body with real Okta API calls
(e.g. via the okta-sdk-python client against /api/v1/users).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, Dict


def _result(ok: bool, action: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tool": "okta",
        "action": action,
        "ok": ok,
        "data": data,
        "executed_at": datetime.utcnow().isoformat() + "Z",
        "mock": True,
    }


def provision_user(
    email: str,
    first_name: str = "",
    last_name: str = "",
    department: str = "",
    groups: list[str] | None = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Create and activate an Okta user account (mocked)."""
    user_id = f"00u{uuid.uuid4().hex[:9]}"
    return _result(
        ok=True,
        action="provision_user",
        data={
            "id": user_id,
            "login": email,
            "status": "ACTIVE",
            "activated": datetime.utcnow().isoformat() + "Z",
            "profile": {
                "email": email,
                "firstName": first_name or email.split("@")[0].split(".")[0].title(),
                "lastName": last_name or email.split("@")[0].split(".")[-1].title(),
                "department": department,
                "login": email,
            },
            "groups_assigned": groups or [],
            "url": f"https://mock.okta.com/api/v1/users/{user_id}",
        },
    )


def deactivate_user(email: str, **kwargs: Any) -> Dict[str, Any]:
    """Deactivate (deprovision) an Okta user account (mocked)."""
    user_id = f"00u{uuid.uuid4().hex[:9]}"
    return _result(
        ok=True,
        action="deactivate_user",
        data={
            "id": user_id,
            "login": email,
            "status": "DEPROVISIONED",
            "deactivated": datetime.utcnow().isoformat() + "Z",
            "url": f"https://mock.okta.com/api/v1/users/{user_id}",
        },
    )


# ── Dispatch table ─────────────────────────────────────────────────────────────

_DISPATCH: Dict[str, Any] = {
    "provision_user": provision_user,
    "deactivate_user": deactivate_user,
}


def execute(action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Generic dispatch: route action name to the correct function."""
    fn = _DISPATCH.get(action)
    if fn is None:
        return _result(
            ok=False,
            action=action,
            data={"error": f"Unknown Okta action: {action}"},
        )
    return fn(**args)
