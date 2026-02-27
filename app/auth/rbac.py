"""RBAC: header-based auth for MVP.

Headers expected on every request:
  X-User-ID:   <user identifier>
  X-User-Role: requester | approver | admin
"""
from enum import Enum
from typing import Optional

from fastapi import Header, HTTPException, status
from pydantic import BaseModel


class Role(str, Enum):
    REQUESTER = "requester"
    APPROVER = "approver"
    ADMIN = "admin"


class UserContext(BaseModel):
    user_id: str
    role: Role


def _parse_user(x_user_id: Optional[str], x_user_role: Optional[str]) -> UserContext:
    if not x_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-User-ID header",
        )
    if not x_user_role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-User-Role header",
        )
    try:
        role = Role(x_user_role.lower())
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Invalid role '{x_user_role}'. Must be one of: {[r.value for r in Role]}",
        )
    return UserContext(user_id=x_user_id, role=role)


def require_role(*allowed_roles: Role):
    """Dependency factory: inject user context and enforce allowed roles."""

    async def dependency(
        x_user_id: Optional[str] = Header(default=None),
        x_user_role: Optional[str] = Header(default=None),
    ) -> UserContext:
        ctx = _parse_user(x_user_id, x_user_role)
        if ctx.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{ctx.role}' is not authorized for this operation. Required: {[r.value for r in allowed_roles]}",
            )
        return ctx

    return dependency


async def get_user_context(
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
) -> UserContext:
    """Dependency: parse user from headers without role restriction."""
    return _parse_user(x_user_id, x_user_role)
