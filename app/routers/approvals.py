"""POST /approvals/{id}/approve and /reject"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.rbac import require_role, Role, UserContext
from app.db import get_db
from app.models.schemas import ApprovalAction, ApprovalResponse, ErrorResponse
from app.models.orm import OpsRequest
from app.services import orchestrator

router = APIRouter(prefix="/approvals", tags=["approvals"])


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
    req = orchestrator.reject_request(db, request_id, body.approver_id, body.reason)
    return ApprovalResponse(
        request_id=req.id,
        decision="REJECTED",
        approver_id=body.approver_id,
        reason=body.reason,
        decided_at=req.approval.decided_at,
    )
