"""POST /requests and GET /requests/{id}"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.orm import Session

from app.auth.rbac import require_role, Role, UserContext
from app.db import get_db
from app.models.orm import OpsRequest, AuditLog
from app.models.schemas import (
    OpsRequestCreate, OpsRequestResponse, ErrorResponse,
    TaskPlan, ClarificationSubmit, AuditLogResponse,
)
from app.services import orchestrator
from app.services.orchestrator import DuplicateRequestError

router = APIRouter(prefix="/requests", tags=["requests"])


def _serialize(req: OpsRequest) -> OpsRequestResponse:
    plan = None
    if req.task_plan:
        plan = TaskPlan(**req.task_plan)
    return OpsRequestResponse(
        id=req.id,
        correlation_id=req.correlation_id,
        idempotency_key=req.idempotency_key,
        requester_id=req.requester_id,
        intent=req.intent,
        payload=req.payload,
        status=req.status,
        task_plan=plan,
        risk_level=req.risk_level,
        risk_score=req.risk_score,
        risk_flags=req.risk_flags,
        request_safety_flags=req.request_safety_flags,
        execution_results=req.execution_results,
        error_message=req.error_message,
        policy_version=req.policy_version,
        prompt_version=req.prompt_version,
        created_at=req.created_at,
        updated_at=req.updated_at,
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=OpsRequestResponse,
    responses={409: {"model": ErrorResponse}},
)
def submit_request(
    body: OpsRequestCreate,
    response: Response,
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.REQUESTER, Role.ADMIN)),
):
    """Submit a new ops request. Returns 409 if idempotency_key already used."""
    try:
        req = orchestrator.submit_request(db, body)
    except DuplicateRequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "Duplicate request",
                "idempotency_key": body.idempotency_key,
                "existing_id": exc.existing_id,
            },
        )
    response.headers["X-Correlation-ID"] = req.correlation_id
    return _serialize(req)


@router.get(
    "/{request_id}",
    response_model=OpsRequestResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_request(
    request_id: str,
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.REQUESTER, Role.APPROVER, Role.ADMIN)),
):
    """Fetch a request by ID."""
    req = db.query(OpsRequest).filter_by(id=request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail=f"Request {request_id} not found")
    return _serialize(req)


@router.post(
    "/{request_id}/clarifications",
    response_model=OpsRequestResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def answer_clarifications(
    request_id: str,
    body: ClarificationSubmit,
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.REQUESTER, Role.ADMIN)),
):
    """Submit answers to clarification questions and resume the pipeline."""
    req = orchestrator.submit_clarification(db, request_id, body.answers)
    return _serialize(req)


@router.get(
    "/{request_id}/audit",
    response_model=List[AuditLogResponse],
    responses={404: {"model": ErrorResponse}},
)
def get_audit_log(
    request_id: str,
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.APPROVER, Role.ADMIN)),
):
    """Return all audit log entries for a request, ordered by creation time.

    Each entry's metadata field includes policy_version, prompt_version,
    model_name, confidence, and safety_flags for full AI traceability.
    """
    req = db.query(OpsRequest).filter_by(id=request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail=f"Request {request_id} not found")
    entries = (
        db.query(AuditLog)
        .filter_by(correlation_id=req.correlation_id)
        .order_by(AuditLog.created_at)
        .all()
    )
    return entries
