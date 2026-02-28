"""Mocked VPN tool adapter.

In production, replace each function body with real VPN management API calls
(e.g. against a WireGuard management API, Cisco AnyConnect, or Tailscale API).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, Dict


def _result(ok: bool, action: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tool": "vpn",
        "action": action,
        "ok": ok,
        "data": data,
        "executed_at": datetime.utcnow().isoformat() + "Z",
        "mock": True,
    }


def grant_access(
    email: str,
    department: str = "",
    profile: str = "standard",
    device_id: str = "",
    **kwargs: Any,
) -> Dict[str, Any]:
    """Issue a VPN certificate and provision access for a user (mocked)."""
    cert_id = f"cert-{uuid.uuid4().hex[:8]}"
    expires_at = (datetime.utcnow() + timedelta(days=365)).isoformat() + "Z"
    return _result(
        ok=True,
        action="grant_access",
        data={
            "cert_id": cert_id,
            "cert_serial": uuid.uuid4().hex[:16].upper(),
            "user_email": email,
            "vpn_profile": profile,
            "allowed_networks": _networks_for_profile(profile, department),
            "device_id": device_id or f"dev-{uuid.uuid4().hex[:6]}",
            "issued_at": datetime.utcnow().isoformat() + "Z",
            "expires_at": expires_at,
            "endpoint": "vpn.acme-fintech.internal:1194",
        },
    )


def revoke_access(email: str, cert_id: str = "", **kwargs: Any) -> Dict[str, Any]:
    """Revoke VPN certificate(s) for a user (mocked)."""
    resolved_cert = cert_id or f"cert-{uuid.uuid4().hex[:8]}"
    return _result(
        ok=True,
        action="revoke_access",
        data={
            "cert_id": resolved_cert,
            "user_email": email,
            "status": "REVOKED",
            "revoked_at": datetime.utcnow().isoformat() + "Z",
            "crl_updated": True,
        },
    )


def _networks_for_profile(profile: str, department: str) -> list[str]:
    """Return the allowed CIDR blocks for a given VPN profile (mock data)."""
    base = ["10.0.0.0/8"]
    if profile == "admin" or department.lower() in ("security", "engineering"):
        base += ["172.16.0.0/12", "192.168.0.0/16"]
    return base


# ── Dispatch table ─────────────────────────────────────────────────────────────

_DISPATCH: Dict[str, Any] = {
    "grant_access": grant_access,
    "revoke_access": revoke_access,
}


def execute(action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Generic dispatch: route action name to the correct function."""
    fn = _DISPATCH.get(action)
    if fn is None:
        return _result(
            ok=False,
            action=action,
            data={"error": f"Unknown VPN action: {action}"},
        )
    return fn(**args)
