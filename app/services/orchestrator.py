"""Ops Orchestrator service.

Pipeline per request:
  1. Compute input hash → idempotency check
  2. Persist OpsRequest (PLANNING) + audit log
  3. Call Claude to generate structured TaskPlan
     3a. Plan needs clarification → NEEDS_CLARIFICATION, return
  4. Run deterministic risk assessment
  5a. LOW/MEDIUM risk  → auto-execute via tool adapters (EXECUTING → COMPLETED)
  5b. HIGH/HUMAN_ONLY → enqueue for approval (AWAITING_APPROVAL)

Clarification loop:
  POST /requests/{id}/clarifications supplies answers → resumes from step 3.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import anthropic
from sqlalchemy.orm import Session

from app.models.orm import OpsRequest, ApprovalRecord, RequestStatus
from app.models.schemas import TaskPlan, TaskStep, RiskLevel, OpsRequestCreate
from app.services import risk as risk_service
from app.observability.logger import audit
from app.queue.memory_queue import approval_queue
from app.tools import slack as slack_adapter
from app.tools import github as github_adapter
from app.tools.catalog import is_allowed
from app.services import injection as injection_service


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash_input(data: Dict[str, Any]) -> str:
    serialized = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode()).hexdigest()


def _tool_dispatch(tool: str, action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Route to the correct mocked tool adapter. Adds execution_duration_ms."""
    _base = {"tool_name": tool, "action_name": action}

    if not is_allowed(tool, action):
        msg = f"Action '{action}' on tool '{tool}' is not in the approved catalog"
        return {
            "tool": tool, "action": action, "ok": False,
            "data": {"error": msg}, "mock": True,
            "execution_duration_ms": 0, "error": msg, **_base,
        }
    adapters = {
        "slack": slack_adapter,
        "github": github_adapter,
    }
    adapter = adapters.get(tool.lower())
    if adapter is None:
        msg = f"Unknown tool: {tool}"
        return {
            "tool": tool, "action": action, "ok": False,
            "data": {"error": msg}, "mock": True,
            "execution_duration_ms": 0, "error": msg, **_base,
        }
    t0 = time.monotonic()
    result = adapter.execute(action, args)
    elapsed_ms = round((time.monotonic() - t0) * 1000, 2)
    return {
        **result,
        "execution_duration_ms": elapsed_ms,
        "error": result.get("data", {}).get("error") if not result.get("ok") else None,
        **_base,
    }


# ── Claude plan generation ─────────────────────────────────────────────────────

PROMPT_VERSION = "1.0.0"
MODEL_NAME = "claude-haiku-4-5-20251001"


def _effective_model() -> str:
    """Return the real model name when an API key is set, 'stub' otherwise."""
    return MODEL_NAME if os.environ.get("ANTHROPIC_API_KEY") else "stub"


def _trace(ops_request: OpsRequest, plan: Optional[TaskPlan] = None) -> Dict[str, Any]:
    """Build consistent traceability context for audit log metadata."""
    return {
        "policy_version": risk_service.POLICY_VERSION,
        "prompt_version": PROMPT_VERSION,
        "model_name": _effective_model(),
        "confidence": plan.confidence if plan else None,
        "safety_flags": ops_request.request_safety_flags or [],
    }


_SYSTEM_PROMPT = """You are an Ops Orchestrator that converts operational requests into structured execution plans.

Given an intent and payload, first decide whether you have enough information to build a concrete plan.

## When required information is MISSING
If user identity, target resource, permission level, or environment cannot be determined,
return ONLY this JSON — no markdown, no explanation:
{
  "needs_clarification": true,
  "questions": [
    "<specific, directly answerable question>",
    ...
  ]
}
Return 2–4 questions maximum. Each must be specific and actionable.

## When you have enough information
Return ONLY valid JSON matching this exact schema:
{
  "needs_clarification": false,
  "plan": [
    {
      "step": <integer starting at 1>,
      "name": "<human-readable step name>",
      "tool": "<slack|github>",
      "action": "<snake_case action name>",
      "args": { "<key>": "<value>" },
      "risk": "<LOW|MEDIUM|HIGH>",
      "requires_approval": <true|false>
    }
  ],
  "assumptions": ["<assumption string>"],
  "policy_flags": ["<policy concern string>"]
}

Rules:
- Use only tools: slack, github
- Keep steps minimal and actionable
- Set risk field to your best guess (the system will override with deterministic rules)
- Flag policy concerns (e.g. granting org access, production changes) in policy_flags
- Return ONLY the JSON object, no markdown, no explanation
"""


def _generate_plan_with_claude(
    correlation_id: str,
    intent: str,
    payload: Dict[str, Any],
    clarifications: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Call Claude to generate a structured task plan. Falls back to stub if no API key."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if not api_key:
        return _stub_plan(intent, payload, clarifications)

    client = anthropic.Anthropic(api_key=api_key)
    user_message = json.dumps({"intent": intent, "payload": payload}, indent=2)

    if clarifications:
        qa_text = "\n".join(f"  Q: {q}\n  A: {a}" for q, a in clarifications.items())
        user_message += f"\n\nClarification answers provided by requester:\n{qa_text}"

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)


def _clars_get(clars: Dict[str, str], *keywords: str) -> Optional[str]:
    """Return the first clarification answer whose question contains any keyword."""
    for question, answer in clars.items():
        if any(kw in question.lower() for kw in keywords):
            return answer.strip() or None
    return None


def _stub_plan(
    intent: str,
    payload: Dict[str, Any],
    clarifications: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Deterministic offline fallback plan for common intents."""
    clars = clarifications or {}
    intent_lower = intent.lower()

    if "onboard" in intent_lower:
        user_email = payload.get("user_email", "new_user@example.com")
        username = user_email.split("@")[0]
        return {
            "plan": [
                {
                    "step": 1,
                    "name": "Add user to GitHub org",
                    "tool": "github",
                    "action": "add_to_org",
                    "args": {"org": "acme-corp", "user": username, "role": "member"},
                    "risk": "HIGH",
                    "requires_approval": True,
                },
                {
                    "step": 2,
                    "name": "Invite user to Slack onboarding channel",
                    "tool": "slack",
                    "action": "invite_to_channel",
                    "args": {"channel": "#onboarding", "user_email": user_email},
                    "risk": "LOW",
                    "requires_approval": False,
                },
                {
                    "step": 3,
                    "name": "Send welcome message",
                    "tool": "slack",
                    "action": "send_message",
                    "args": {
                        "channel": "#general",
                        "text": f"Welcome to the team, {username}! :wave:",
                    },
                    "risk": "LOW",
                    "requires_approval": False,
                },
            ],
            "assumptions": [
                "GitHub org is 'acme-corp'",
                f"Username derived from email: {username}",
                "Default GitHub org membership role: 'member'",
            ],
            "policy_flags": [
                "Adding user to GitHub org requires approval per access-control policy"
            ],
        }

    if "offboard" in intent_lower or "revoke" in intent_lower:
        user_email = payload.get("user_email", "user@example.com")
        username = user_email.split("@")[0]
        return {
            "plan": [
                {
                    "step": 1,
                    "name": "Remove user from GitHub org",
                    "tool": "github",
                    "action": "remove_from_org",
                    "args": {"org": "acme-corp", "user": username},
                    "risk": "HUMAN_ONLY",
                    "requires_approval": True,
                },
                {
                    "step": 2,
                    "name": "Notify team of departure",
                    "tool": "slack",
                    "action": "send_message",
                    "args": {"channel": "#general", "text": f"{username} has left the organization."},
                    "risk": "LOW",
                    "requires_approval": False,
                },
            ],
            "assumptions": [],
            "policy_flags": ["Offboarding actions are HUMAN_ONLY per security policy"],
        }

    # Access grant — may need clarification if required fields are absent
    if "access" in intent_lower or "grant" in intent_lower or "collaborator" in intent_lower:
        user_email = (
            payload.get("user_email")
            or _clars_get(clars, "user", "email", "who")
        )
        repo = (
            payload.get("repo") or payload.get("repository")
            or _clars_get(clars, "repo", "repository")
        )
        permission = (
            payload.get("permission") or payload.get("role")
            or _clars_get(clars, "permission", "level", "access level")
        )

        questions: List[str] = []
        if not user_email:
            questions.append("Which user should be granted access? (provide their email address)")
        if not repo:
            questions.append("Which repository should access be granted to?")
        if not permission:
            questions.append("What permission level is needed? (read / write / admin)")

        if questions:
            return {"needs_clarification": True, "questions": questions}

        username = user_email.split("@")[0]
        return {
            "plan": [
                {
                    "step": 1,
                    "name": f"Add {username} as collaborator on {repo}",
                    "tool": "github",
                    "action": "add_collaborator",
                    "args": {"repo": repo, "user": username, "permission": permission},
                    "risk": "HIGH",
                    "requires_approval": True,
                },
            ],
            "assumptions": [
                f"Username derived from email: {username}",
                "Default org: 'acme-corp'",
            ],
            "policy_flags": [
                "Granting repository access requires approval per access-control policy"
            ],
        }

    # Generic fallback
    return {
        "plan": [
            {
                "step": 1,
                "name": f"Execute: {intent}",
                "tool": "slack",
                "action": "send_message",
                "args": {
                    "channel": "#ops",
                    "text": f"Ops request received: {intent}. Payload: {json.dumps(payload)}",
                },
                "risk": "LOW",
                "requires_approval": False,
            }
        ],
        "assumptions": ["No specific handler found; defaulting to Slack notification"],
        "policy_flags": [],
    }


# ── Main orchestration pipeline ────────────────────────────────────────────────

class DuplicateRequestError(Exception):
    def __init__(self, existing_id: str) -> None:
        self.existing_id = existing_id
        super().__init__(f"Duplicate idempotency_key; existing request id={existing_id}")


def submit_request(
    db: Session,
    body: OpsRequestCreate,
) -> OpsRequest:
    """Full orchestration pipeline. Returns the persisted OpsRequest."""
    input_data = body.model_dump()
    input_hash = _hash_input(input_data)
    correlation_id = str(uuid.uuid4())

    # ── Step 1: Idempotency check ──────────────────────────────────────────
    existing = db.query(OpsRequest).filter_by(idempotency_key=body.idempotency_key).first()
    if existing:
        raise DuplicateRequestError(existing.id)

    # ── Step 2: Persist request ────────────────────────────────────────────
    ops_request = OpsRequest(
        id=str(uuid.uuid4()),
        correlation_id=correlation_id,
        idempotency_key=body.idempotency_key,
        requester_id=body.requester_id,
        intent=body.intent,
        payload=body.payload,
        input_hash=input_hash,
        status=RequestStatus.PLANNING,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(ops_request)
    db.commit()

    audit(
        db,
        correlation_id=correlation_id,
        actor=body.requester_id,
        action="REQUEST_SUBMITTED",
        input_hash=input_hash,
        decision="PLANNING",
        metadata={
            "intent": body.intent,
            "idempotency_key": body.idempotency_key,
            "policy_version": risk_service.POLICY_VERSION,
            "prompt_version": PROMPT_VERSION,
            "model_name": _effective_model(),
        },
    )

    # ── Step 2b: Safety scan ───────────────────────────────────────────────
    safety_flags = injection_service.scan(body.intent, body.payload)
    if safety_flags:
        ops_request.request_safety_flags = safety_flags
        db.commit()
        audit(
            db,
            correlation_id=correlation_id,
            actor=body.requester_id,
            action="SAFETY_FLAGS_DETECTED",
            input_hash=input_hash,
            decision="FLAGGED",
            metadata={
                "flags": safety_flags,
                "policy_version": risk_service.POLICY_VERSION,
                "prompt_version": PROMPT_VERSION,
                "model_name": _effective_model(),
            },
        )

    # ── Step 3: Generate task plan via Claude ──────────────────────────────
    try:
        raw_plan = _generate_plan_with_claude(correlation_id, body.intent, body.payload)
    except Exception as exc:
        _fail_request(db, ops_request, f"Plan generation failed: {exc}")
        raise

    # ── Step 4/5: Route on plan result ─────────────────────────────────────
    if raw_plan.get("needs_clarification"):
        _handle_needs_clarification(db, ops_request, raw_plan)
    else:
        _risk_and_route(db, ops_request, raw_plan, input_hash)

    db.refresh(ops_request)
    return ops_request


def submit_clarification(
    db: Session,
    request_id: str,
    answers: Dict[str, str],
) -> OpsRequest:
    """Submit clarification answers and resume the orchestration pipeline."""
    ops_request = _get_or_404(db, request_id)
    _assert_status(ops_request, RequestStatus.NEEDS_CLARIFICATION)

    # Persist answers and transition back to PLANNING
    ops_request.clarification_answers = answers
    ops_request.status = RequestStatus.PLANNING
    ops_request.updated_at = datetime.utcnow()
    db.commit()

    audit(
        db,
        correlation_id=ops_request.correlation_id,
        actor=ops_request.requester_id,
        action="CLARIFICATION_SUBMITTED",
        input_hash=ops_request.input_hash,
        decision="PLANNING",
        metadata={
            "answer_count": len(answers),
            "policy_version": risk_service.POLICY_VERSION,
            "prompt_version": PROMPT_VERSION,
            "model_name": _effective_model(),
        },
    )

    # Re-run plan generation with original payload + clarification answers
    try:
        raw_plan = _generate_plan_with_claude(
            ops_request.correlation_id,
            ops_request.intent,
            ops_request.payload,
            clarifications=answers,
        )
    except Exception as exc:
        _fail_request(db, ops_request, f"Plan regeneration failed: {exc}")
        raise

    if raw_plan.get("needs_clarification"):
        _handle_needs_clarification(db, ops_request, raw_plan)
    else:
        _risk_and_route(db, ops_request, raw_plan, ops_request.input_hash)

    db.refresh(ops_request)
    return ops_request


def _execute_steps(steps: List[TaskStep]) -> List[Dict[str, Any]]:
    """Execute non-approval-gated steps via tool adapters.

    HUMAN_ONLY steps are explicitly refused here as a defence-in-depth
    measure — they must never reach this path, but the check makes the
    invariant explicit and produces a clear error if it is somehow violated.
    """
    results = []
    for step in steps:
        if step.risk == RiskLevel.HUMAN_ONLY:
            results.append({
                "step": step.step,
                "name": step.name,
                "skipped": True,
                "error": True,
                "reason": (
                    f"HUMAN_ONLY step '{step.action}' cannot be auto-executed"
                    " — mandatory human review required"
                ),
            })
            continue
        if step.requires_approval:
            results.append({
                "step": step.step,
                "skipped": True,
                "reason": "Requires approval — not auto-executed",
            })
            continue
        result = _tool_dispatch(step.tool, step.action, step.args)
        results.append({"step": step.step, "name": step.name, **result})
    return results


# ── Pipeline helpers ───────────────────────────────────────────────────────────

def _handle_needs_clarification(
    db: Session,
    ops_request: OpsRequest,
    raw_plan: Dict[str, Any],
) -> None:
    """Store clarification questions and park the request."""
    ops_request.task_plan = TaskPlan(
        correlation_id=ops_request.correlation_id,
        questions=raw_plan.get("questions", []),
    ).model_dump()
    ops_request.status = RequestStatus.NEEDS_CLARIFICATION
    ops_request.updated_at = datetime.utcnow()
    db.commit()

    audit(
        db,
        correlation_id=ops_request.correlation_id,
        actor="system",
        action="NEEDS_CLARIFICATION",
        input_hash=ops_request.input_hash,
        decision="NEEDS_CLARIFICATION",
        metadata={
            "questions": raw_plan.get("questions", []),
            "policy_version": risk_service.POLICY_VERSION,
            "prompt_version": PROMPT_VERSION,
            "model_name": _effective_model(),
        },
    )


def _risk_and_route(
    db: Session,
    ops_request: OpsRequest,
    raw_plan: Dict[str, Any],
    input_hash: str,
) -> None:
    """Risk-assess raw_plan, persist TaskPlan, then route to auto-exec or approval."""
    raw_steps = raw_plan.get("plan", [])
    steps = [TaskStep(**s) for s in raw_steps]
    assessment = risk_service.assess(steps)

    # Escalate to HUMAN_ONLY if safety flags were detected — prompt injection
    # attempts must always get human review regardless of step-level risk.
    safety_flags = ops_request.request_safety_flags or []
    if safety_flags:
        assessment.overall_risk = RiskLevel.HUMAN_ONLY
        assessment.score = 1.0
        assessment.needs_human_approval = True
        assessment.flags = [f"SAFETY: {f}" for f in safety_flags] + assessment.flags
        assessment.summary = (
            f"SAFETY FLAGS DETECTED: {', '.join(safety_flags)}. " + assessment.summary
        )

    plan = TaskPlan(
        correlation_id=ops_request.correlation_id,
        plan=assessment.annotated_steps,
        assumptions=raw_plan.get("assumptions", []),
        policy_flags=raw_plan.get("policy_flags", []) + assessment.flags,
        policy_references=assessment.policy_references,
        evidence=assessment.evidence,
        confidence=assessment.confidence,
        needs_human_approval=assessment.needs_human_approval,
        overall_risk=assessment.overall_risk,
        risk_summary=assessment.summary,
        model_name=_effective_model(),
        safety_flags=ops_request.request_safety_flags or [],
        policy_version=risk_service.POLICY_VERSION,
        prompt_version=PROMPT_VERSION,
    )

    ops_request.task_plan = plan.model_dump()
    ops_request.risk_level = assessment.overall_risk
    ops_request.risk_score = assessment.score
    ops_request.risk_flags = assessment.flags
    ops_request.policy_version = risk_service.POLICY_VERSION
    ops_request.prompt_version = PROMPT_VERSION
    ops_request.updated_at = datetime.utcnow()

    audit(
        db,
        correlation_id=ops_request.correlation_id,
        actor="system",
        action="PLAN_GENERATED",
        input_hash=input_hash,
        decision=assessment.overall_risk,
        metadata={
            "risk_summary": assessment.summary,
            "step_count": len(steps),
            **_trace(ops_request, plan),
        },
    )

    if not assessment.needs_human_approval:
        ops_request.status = RequestStatus.EXECUTING
        db.commit()

        results = _execute_steps(assessment.annotated_steps)
        ops_request.execution_results = results
        ops_request.status = RequestStatus.COMPLETED
        ops_request.updated_at = datetime.utcnow()
        db.commit()

        audit(
            db,
            correlation_id=ops_request.correlation_id,
            actor="system",
            action="AUTO_EXECUTED",
            input_hash=input_hash,
            decision="COMPLETED",
            metadata={"results_count": len(results), **_trace(ops_request, plan)},
        )
    else:
        ops_request.status = RequestStatus.AWAITING_APPROVAL
        db.commit()

        _enqueue_for_approval(ops_request, plan, assessment)

        approval_record = ApprovalRecord(
            id=str(uuid.uuid4()),
            request_id=ops_request.id,
            queued_at=datetime.utcnow(),
        )
        db.add(approval_record)
        db.commit()

        audit(
            db,
            correlation_id=ops_request.correlation_id,
            actor="system",
            action="QUEUED_FOR_APPROVAL",
            input_hash=input_hash,
            decision="AWAITING_APPROVAL",
            metadata={
                "risk_level": assessment.overall_risk,
                "flags": assessment.flags,
                **_trace(ops_request, plan),
            },
        )


def _enqueue_for_approval(ops_request: OpsRequest, plan: TaskPlan, assessment: Any) -> None:
    """Fire-and-forget: put request on the in-memory approval queue."""
    import asyncio
    queue_payload = {
        "correlation_id": ops_request.correlation_id,
        "requester_id": ops_request.requester_id,
        "intent": ops_request.intent,
        "plan": plan.model_dump(),
        "risk_level": assessment.overall_risk,
    }
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(approval_queue.enqueue(ops_request.id, queue_payload))
        else:
            loop.run_until_complete(approval_queue.enqueue(ops_request.id, queue_payload))
    except RuntimeError:
        asyncio.run(approval_queue.enqueue(ops_request.id, queue_payload))


def approve_request(
    db: Session,
    request_id: str,
    approver_id: str,
    reason: Optional[str] = None,
) -> OpsRequest:
    """Approve a queued request: execute all steps and mark COMPLETED."""
    ops_request = _get_or_404(db, request_id)
    _assert_status(ops_request, RequestStatus.AWAITING_APPROVAL)

    # HUMAN_ONLY approvals require a substantive written justification.
    # No role — including admin — can bypass this gate.
    plan_data = ops_request.task_plan or {}
    overall_risk = plan_data.get("overall_risk")
    if overall_risk == RiskLevel.HUMAN_ONLY:
        if not reason or len(reason.strip()) < 20:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=422,
                detail=(
                    "decision_reason is required (minimum 20 characters) "
                    "for HUMAN_ONLY approvals — no role may bypass this gate"
                ),
            )

    ops_request.approval.approver_id = approver_id
    ops_request.approval.decision = "APPROVED"
    ops_request.approval.reason = reason
    ops_request.approval.decided_at = datetime.utcnow()
    ops_request.status = RequestStatus.EXECUTING
    ops_request.updated_at = datetime.utcnow()
    db.commit()

    _plan_trace = {
        "policy_version": plan_data.get("policy_version", risk_service.POLICY_VERSION),
        "prompt_version": plan_data.get("prompt_version", PROMPT_VERSION),
        "model_name": plan_data.get("model_name", _effective_model()),
        "confidence": plan_data.get("confidence"),
        "safety_flags": ops_request.request_safety_flags or [],
    }

    audit(
        db,
        correlation_id=ops_request.correlation_id,
        actor=approver_id,
        action="REQUEST_APPROVED",
        input_hash=ops_request.input_hash,
        decision="APPROVED",
        metadata={
            "decision_reason": reason,
            "overall_risk": overall_risk,
            "human_only_gate": overall_risk == RiskLevel.HUMAN_ONLY,
            **_plan_trace,
        },
    )

    plan_data = ops_request.task_plan or {}
    raw_steps = plan_data.get("plan", [])
    steps = [TaskStep(**s) for s in raw_steps]

    results = []
    for step in steps:
        result = _tool_dispatch(step.tool, step.action, step.args)
        results.append({"step": step.step, "name": step.name, **result})

    ops_request.execution_results = results
    ops_request.status = RequestStatus.COMPLETED
    ops_request.updated_at = datetime.utcnow()
    db.commit()

    audit(
        db,
        correlation_id=ops_request.correlation_id,
        actor="system",
        action="APPROVED_EXECUTION_COMPLETE",
        input_hash=ops_request.input_hash,
        decision="COMPLETED",
        metadata={"results_count": len(results), **_plan_trace},
    )

    db.refresh(ops_request)
    return ops_request


def reject_request(
    db: Session,
    request_id: str,
    approver_id: str,
    reason: Optional[str] = None,
) -> OpsRequest:
    """Reject a queued request."""
    ops_request = _get_or_404(db, request_id)
    _assert_status(ops_request, RequestStatus.AWAITING_APPROVAL)

    ops_request.approval.approver_id = approver_id
    ops_request.approval.decision = "REJECTED"
    ops_request.approval.reason = reason
    ops_request.approval.decided_at = datetime.utcnow()
    ops_request.status = RequestStatus.REJECTED
    ops_request.updated_at = datetime.utcnow()
    db.commit()

    audit(
        db,
        correlation_id=ops_request.correlation_id,
        actor=approver_id,
        action="REQUEST_REJECTED",
        input_hash=ops_request.input_hash,
        decision="REJECTED",
        metadata={
            "reason": reason,
            "policy_version": (ops_request.task_plan or {}).get("policy_version", risk_service.POLICY_VERSION),
            "prompt_version": (ops_request.task_plan or {}).get("prompt_version", PROMPT_VERSION),
            "model_name": (ops_request.task_plan or {}).get("model_name", _effective_model()),
            "confidence": (ops_request.task_plan or {}).get("confidence"),
            "safety_flags": ops_request.request_safety_flags or [],
        },
    )

    db.refresh(ops_request)
    return ops_request


# ── Internal helpers ───────────────────────────────────────────────────────────

def _get_or_404(db: Session, request_id: str) -> OpsRequest:
    obj = db.query(OpsRequest).filter_by(id=request_id).first()
    if not obj:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Request {request_id} not found")
    return obj


def _assert_status(obj: OpsRequest, expected: RequestStatus) -> None:
    if obj.status != expected:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=409,
            detail=f"Request is in status '{obj.status}', expected '{expected}'",
        )


def _fail_request(db: Session, obj: OpsRequest, error: str) -> None:
    obj.status = RequestStatus.FAILED
    obj.error_message = error
    obj.updated_at = datetime.utcnow()
    db.commit()
