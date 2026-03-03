"""Mocked GitHub tool adapter.

In production, replace each function body with real GitHub API calls
(e.g. via PyGitHub or httpx against the REST API).
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


def add_to_org(org: str, user: str, role: str = "member", **kwargs: Any) -> Dict[str, Any]:
    """Add a user to a GitHub organization (mocked)."""
    return _result(
        ok=True,
        tool="github",
        action="add_to_org",
        data={
            "org": org,
            "user": user,
            "role": role,
            "invitation_id": str(uuid.uuid4()),
            "url": f"https://github.com/orgs/{org}/members/{user}",
        },
    )


def create_pr(repo: str, title: str, body: str = "", base: str = "main", head: str = "", **kwargs: Any) -> Dict[str, Any]:
    """Open a pull request (mocked)."""
    pr_number = uuid.uuid4().int % 9000 + 1000
    return _result(
        ok=True,
        tool="github",
        action="create_pr",
        data={
            "repo": repo,
            "pr_number": pr_number,
            "title": title,
            "url": f"https://github.com/{repo}/pull/{pr_number}",
            "state": "open",
        },
    )


def add_collaborator(repo: str, user: str, permission: str = "read", org: str = "acme-corp", **kwargs: Any) -> Dict[str, Any]:
    """Add a collaborator to a GitHub repository with the given permission (mocked)."""
    return _result(
        ok=True,
        tool="github",
        action="add_collaborator",
        data={
            "repo": repo,
            "user": user,
            "permission": permission,
            "url": f"https://github.com/{org}/{repo}/collaborators/{user}",
        },
    )


def remove_from_org(org: str, user: str, **kwargs: Any) -> Dict[str, Any]:
    """Remove a user from a GitHub organization (mocked)."""
    return _result(
        ok=True,
        tool="github",
        action="remove_from_org",
        data={"org": org, "user": user, "status": "removed"},
    )


# ── Dispatch table ─────────────────────────────────────────────────────────────

_DISPATCH: Dict[str, Any] = {
    "add_to_org": add_to_org,
    "add_collaborator": add_collaborator,
    "create_pr": create_pr,
    "remove_from_org": remove_from_org,
}


def execute(action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Generic dispatch: route action name to the correct function."""
    fn = _DISPATCH.get(action)
    if fn is None:
        return _result(
            ok=False,
            tool="github",
            action=action,
            data={"error": f"Unknown GitHub action: {action}"},
        )
    return fn(**args)
