"""Demo endpoint: /demo/onboard

Runs the full orchestration pipeline end-to-end with mocked tools.
No auth required — useful for quick smoke tests and demos.
"""
import uuid
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.schemas import OpsRequestCreate, OpsRequestResponse, TaskPlan
from app.models.orm import OpsRequest
from app.services import orchestrator
from app.services.orchestrator import DuplicateRequestError

router = APIRouter(prefix="/demo", tags=["demo"])


def _serialize(req: OpsRequest) -> OpsRequestResponse:
    plan = TaskPlan(**req.task_plan) if req.task_plan else None
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
        execution_results=req.execution_results,
        error_message=req.error_message,
        created_at=req.created_at,
        updated_at=req.updated_at,
    )


@router.post(
    "/onboard",
    response_model=OpsRequestResponse,
    summary="Demo: full onboard_user pipeline (mocked Slack + GitHub, no auth required)",
)
def demo_onboard(
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Runs an end-to-end onboarding request with a random idempotency key.
    Steps:
      1. Adds user to GitHub org (HIGH risk → approval required)
      2. Invites user to Slack channel (LOW risk → auto-executed)
      3. Sends welcome Slack message (LOW risk → auto-executed)

    Because the plan contains a HIGH-risk step, the request will land in
    AWAITING_APPROVAL status. Use POST /approvals/{id}/approve to continue.
    """
    # Fresh idempotency key per call so demo is always runnable
    idempotency_key = f"demo-onboard-{uuid.uuid4().hex[:8]}"

    body = OpsRequestCreate(
        idempotency_key=idempotency_key,
        requester_id="demo-user@acme.com",
        role="requester",
        intent="onboard_user",
        payload={
            "user_email": "alice@acme.com",
            "start_date": "2026-03-01",
            "team": "engineering",
        },
    )

    try:
        req = orchestrator.submit_request(db, body)
    except DuplicateRequestError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail={"existing_id": exc.existing_id})

    response.headers["X-Correlation-ID"] = req.correlation_id
    return _serialize(req)
