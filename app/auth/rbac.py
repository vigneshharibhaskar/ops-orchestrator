"""JWT-based RBAC dependency.

Every protected endpoint gets a UserContext injected via require_role().
The token is read from the Authorization: Bearer <token> header.
"""
from enum import Enum
from typing import Optional

from fastapi import Header, HTTPException, status
from jose import JWTError
from pydantic import BaseModel

from app.auth.jwt import decode_token


class Role(str, Enum):
    REQUESTER = "requester"
    APPROVER = "approver"
    ADMIN = "admin"
    HR = "hr"


class UserContext(BaseModel):
    user_id: str  # email from JWT
    role: Role


def _parse_token(authorization: Optional[str]) -> UserContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization[7:]
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        role = Role(payload["role"])
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token missing or invalid role claim",
        )
    return UserContext(
        user_id=payload.get("email", payload.get("sub", "")),
        role=role,
    )


def require_role(*allowed_roles: Role):
    """Dependency factory: inject user context and enforce allowed roles."""

    async def dependency(
        authorization: Optional[str] = Header(default=None),
    ) -> UserContext:
        ctx = _parse_token(authorization)
        if ctx.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{ctx.role}' is not authorized for this operation. Required: {[r.value for r in allowed_roles]}",
            )
        return ctx

    return dependency


async def get_user_context(
    authorization: Optional[str] = Header(default=None),
) -> UserContext:
    """Dependency: parse user from token without role restriction."""
    return _parse_token(authorization)
