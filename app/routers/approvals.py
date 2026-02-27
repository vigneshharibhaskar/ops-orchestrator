"""POST /approvals/{id}/approve|reject, GET /approvals/pending"""
from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.rbac import require_role, Role, UserContext
from app.db import get_db
from app.models.orm import OpsRequest, RequestStatus
from app.models.schemas import (
    ApprovalAction, ApprovalResponse, ErrorResponse, PendingApprovalItem,
)
from app.services import orchestrator

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get(
    "/pending",
    response_model=List[PendingApprovalItem],
)
def get_pending_approvals(
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.APPROVER, Role.ADMIN)),
):
    """Return all requests currently awaiting approval."""
    rows = (
        db.query(OpsRequest)
        .filter(OpsRequest.status == RequestStatus.AWAITING_APPROVAL)
        .order_by(OpsRequest.created_at.desc())
        .all()
    )
    return [
        PendingApprovalItem(
            id=r.id,
            correlation_id=r.correlation_id,
            requester_id=r.requester_id,
            intent=r.intent,
            created_at=r.created_at,
            overall_risk=r.risk_level,
            needs_human_approval=r.risk_level in ("HIGH", "HUMAN_ONLY"),
        )
        for r in rows
    ]


@router.post(
    "/{request_id}/approve",
    response_model=ApprovalResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def approve(
    request_id: str,
    body: ApprovalAction,
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.APPROVER, Role.ADMIN)),
):
    """Approve a pending request and trigger execution."""
    # Approver identity comes from the JWT — ignore whatever the body claims.
    body.approver_id = user.user_id
    req = orchestrator.approve_request(db, request_id, body.approver_id, body.reason)
    return ApprovalResponse(
        request_id=req.id,
        decision="APPROVED",
        approver_id=body.approver_id,
        reason=body.reason,
        decided_at=req.approval.decided_at,
    )


@router.post(
    "/{request_id}/reject",
    response_model=ApprovalResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def reject(
    request_id: str,
    body: ApprovalAction,
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.APPROVER, Role.ADMIN)),
):
    """Reject a pending request."""
    body.approver_id = user.user_id
    req = orchestrator.reject_request(db, request_id, body.approver_id, body.reason)
    return ApprovalResponse(
        request_id=req.id,
        decision="REJECTED",
        approver_id=body.approver_id,
        reason=body.reason,
        decided_at=req.approval.decided_at,
    )
