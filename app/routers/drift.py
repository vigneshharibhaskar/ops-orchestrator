"""GET /drift — access drift detection endpoint."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.rbac import require_role, Role, UserContext
from app.db import get_db
from app.services.drift import scan, DriftItem

router = APIRouter(prefix="/drift", tags=["drift"])


class DriftResponse(BaseModel):
    email: str
    system: str
    drift_type: str
    severity: str
    detail: str
    last_grant_id: Optional[str] = None
    last_grant_date: Optional[str] = None
    days_since_grant: Optional[int] = None
    department: Optional[str] = None


def _serialize(item: DriftItem) -> DriftResponse:
    return DriftResponse(
        email=item.email,
        system=item.system,
        drift_type=item.drift_type,
        severity=item.severity,
        detail=item.detail,
        last_grant_id=item.last_grant_id,
        last_grant_date=item.last_grant_date,
        days_since_grant=item.days_since_grant,
        department=item.department,
    )


@router.get("", response_model=List[DriftResponse])
def get_drift(
    email: Optional[str] = Query(default=None, description="Filter to a specific user email"),
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.APPROVER, Role.ADMIN)),
):
    """Scan for access drift: unexpected, missing, and stale access.

    Returns drift items derived entirely from the OpsRequest history
    compared against the HR department access policy.

    Optional ?email= filter restricts results to a single user.
    """
    items = scan(db, email=email)
    return [_serialize(item) for item in items]
