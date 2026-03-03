"""Tool execution allowlist (tool catalog).

Only tools and actions listed here can be executed by the orchestrator.
Any step whose tool/action is absent is blocked before dispatch, which
limits the blast radius of prompt-injection attacks that attempt to invoke
arbitrary or destructive tool calls.

To add a new capability:
  1. Implement the adapter method in app/tools/<tool>.py
  2. Add the action name to the frozenset below
  3. Bump POLICY_VERSION in app/services/risk.py
"""
from __future__ import annotations

from typing import Dict, FrozenSet

# Map: tool_name (lower-case) → frozenset of allowed action names (lower-case)
TOOL_CATALOG: Dict[str, FrozenSet[str]] = {
    "slack": frozenset({
        "send_message",
        "invite_to_channel",
    }),
    "github": frozenset({
        "add_to_org",
        "add_collaborator",
        "remove_from_org",
        "create_pr",
    }),
    "okta": frozenset({
        "provision_user",
        "deactivate_user",
    }),
    "google_workspace": frozenset({
        "create_user",
        "suspend_user",
    }),
    "vpn": frozenset({
        "grant_access",
        "revoke_access",
    }),
    "netsuite": frozenset({
        "provision_user",
        "deactivate_user",
    }),
    "workday": frozenset({
        "provision_user",
        "deactivate_user",
    }),
}


def is_allowed(tool: str, action: str) -> bool:
    """Return True iff tool+action pair is in the approved catalog."""
    return action.lower() in TOOL_CATALOG.get(tool.lower(), frozenset())
