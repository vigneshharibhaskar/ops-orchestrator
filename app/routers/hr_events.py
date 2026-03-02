"""POST /hr/events — HR lifecycle event intake, policy reasoning, and orchestration."""
from __future__ import annotations

import hashlib
from typing import List

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.rbac import require_role, Role, UserContext
from app.db import get_db
from app.models.orm import OpsRequest, RequestStatus
from app.models.schemas import ErrorResponse, HREventRequest, OpsRequestCreate
from app.services import orchestrator
from app.services.hr_policy import reason_about_access
from app.services.orchestrator import DuplicateRequestError

router = APIRouter(prefix="/hr", tags=["hr"])


# ── Response schema ───────────────────────────────────────────────────────────


class ActionSummary(BaseModel):
    request_id: str
    system: str
    action: str       # "provision" | "revoke"
    risk: str
    status: str


class HREventResponse(BaseModel):
    event_id: str
    employee: str     # name (new_hire) or email (role_change / termination)
    total_actions: int
    auto_executing: int
    awaiting_approval: int
    actions: List[ActionSummary]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _event_id(body: HREventRequest) -> str:
    """Stable 12-char hex ID derived from event content — drives idempotency keys.

    Same event payload → same event_id → DuplicateRequestError on each sub-request
    → safe to retry the entire POST /hr/events call.
    """
    return hashlib.sha256(body.event.model_dump_json().encode()).hexdigest()[:12]


def _employee_label(event) -> str:
    return getattr(event, "name", None) or event.email


# ── Endpoint ─────────────────────────────────────────────────────────────────


@router.post(
    "/events",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=HREventResponse,
    responses={422: {}, 403: {"model": ErrorResponse}},
)
def ingest_hr_event(
    body: HREventRequest,
    db: Session = Depends(get_db),
    user: UserContext = Depends(require_role(Role.ADMIN, Role.HR)),
):
    """Validate an HR lifecycle event, derive access actions via policy engine,
    and fan out one OpsRequest per action through the standard orchestrator pipeline.
    """
    event = body.event
    event_id = _event_id(body)
    access_actions = reason_about_access(event)

    # JSON-safe event fields for payload (converts date → ISO string, drops "type")
    event_data = {k: v for k, v in event.model_dump(mode="json").items() if k != "type"}

    summaries: List[ActionSummary] = []
    auto_executing = 0
    awaiting_approval = 0

    for access_action in access_actions:
        idem_key = f"{event_id}-{access_action.system}-{access_action.action}"

        payload = {
            "system": access_action.system,
            "action": access_action.action,
            "risk": access_action.risk.value,
            "reason": access_action.reason,
            **event_data,
        }

        create = OpsRequestCreate(
            idempotency_key=idem_key,
            requester_id=user.user_id,
            intent=f"{access_action.action}_{access_action.system}_access",
            payload=payload,
        )

        try:
            ops_req = orchestrator.submit_request(db, create)
        except DuplicateRequestError as exc:
            ops_req = db.query(OpsRequest).filter_by(id=exc.existing_id).first()

        final_status = str(ops_req.status) if ops_req else "unknown"

        if final_status == RequestStatus.COMPLETED:
            auto_executing += 1
        elif final_status in (RequestStatus.AWAITING_APPROVAL, RequestStatus.APPROVED):
            awaiting_approval += 1

        summaries.append(ActionSummary(
            request_id=ops_req.id if ops_req else "unknown",
            system=access_action.system,
            action=access_action.action,
            risk=access_action.risk.value,
            status=final_status,
        ))

    return HREventResponse(
        event_id=event_id,
        employee=_employee_label(event),
        total_actions=len(access_actions),
        auto_executing=auto_executing,
        awaiting_approval=awaiting_approval,
        actions=summaries,
    )
