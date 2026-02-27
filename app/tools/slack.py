"""Mocked Slack tool adapter.

In production, replace the body of each function with real Slack API calls.
All functions return a ToolResult dict for uniform handling in the orchestrator.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict


def _result(ok: bool, tool: str, action: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tool": tool,
        "action": action,
        "ok": ok,
        "data": data,
        "executed_at": datetime.utcnow().isoformat() + "Z",
        "mock": True,
    }


def send_message(channel: str, text: str, **kwargs: Any) -> Dict[str, Any]:
    """Post a message to a Slack channel (mocked)."""
    message_ts = f"{datetime.utcnow().timestamp():.6f}"
    return _result(
        ok=True,
        tool="slack",
        action="send_message",
        data={
            "channel": channel,
            "text": text,
            "message_ts": message_ts,
            "permalink": f"https://mock.slack.com/archives/{channel}/p{message_ts.replace('.', '')}",
        },
    )


def invite_to_channel(channel: str, user_email: str, **kwargs: Any) -> Dict[str, Any]:
    """Invite a user to a Slack channel (mocked)."""
    return _result(
        ok=True,
        tool="slack",
        action="invite_to_channel",
        data={
            "channel": channel,
            "user_email": user_email,
            "mock_user_id": f"U{uuid.uuid4().hex[:8].upper()}",
        },
    )


# ── Dispatch table ─────────────────────────────────────────────────────────────

_DISPATCH: Dict[str, Any] = {
    "send_message": send_message,
    "invite_to_channel": invite_to_channel,
}


def execute(action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Generic dispatch: route action name to the correct function."""
    fn = _DISPATCH.get(action)
    if fn is None:
        return _result(
            ok=False,
            tool="slack",
            action=action,
            data={"error": f"Unknown Slack action: {action}"},
        )
    return fn(**args)
