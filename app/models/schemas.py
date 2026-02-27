"""Pydantic schemas for request/response validation."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class Role(str, Enum):
    REQUESTER = "requester"
    APPROVER = "approver"
    ADMIN = "admin"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    HUMAN_ONLY = "HUMAN_ONLY"


class RequestStatus(str, Enum):
    PENDING = "PENDING"
    PLANNING = "PLANNING"
    NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTING = "EXECUTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


# ── Request schemas ──────────────────────────────────────────────────────────


class OpsRequestCreate(BaseModel):
    idempotency_key: str = Field(..., min_length=1, max_length=255)
    requester_id: str = Field(..., min_length=1, max_length=255)
    role: Role = Role.REQUESTER
    intent: str = Field(..., min_length=1, max_length=255)
    payload: Dict[str, Any] = Field(default_factory=dict)


# ── Explainability schemas ────────────────────────────────────────────────────


class PolicyReference(BaseModel):
    id: str
    title: str
    severity: RiskLevel


class EvidenceItem(BaseModel):
    type: Literal["keyword", "field", "tool", "permission", "target"]
    field: Optional[str] = None
    value: Optional[str] = None
    snippet: Optional[str] = None


# ── Task plan schemas ────────────────────────────────────────────────────────


class TaskStep(BaseModel):
    step_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    step: int
    name: str
    tool: str
    action: str
    args: Dict[str, Any] = Field(default_factory=dict)
    risk: RiskLevel
    requires_approval: bool = False
    reason: Optional[str] = None


class TaskPlan(BaseModel):
    correlation_id: str
    plan: List[TaskStep] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    policy_flags: List[str] = Field(default_factory=list)
    policy_references: List[PolicyReference] = Field(default_factory=list)
    evidence: List[EvidenceItem] = Field(default_factory=list)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    questions: List[str] = Field(default_factory=list)
    needs_human_approval: bool = False
    overall_risk: RiskLevel = RiskLevel.LOW
    risk_summary: Optional[str] = None
    model_name: Optional[str] = None
    safety_flags: List[str] = Field(default_factory=list)
    policy_version: Optional[str] = None
    prompt_version: Optional[str] = None


# ── Response schemas ─────────────────────────────────────────────────────────


class OpsRequestResponse(BaseModel):
    id: str
    correlation_id: str
    idempotency_key: str
    requester_id: str
    intent: str
    payload: Dict[str, Any]
    status: RequestStatus
    task_plan: Optional[TaskPlan] = None
    risk_level: Optional[RiskLevel] = None
    risk_score: Optional[float] = None
    risk_flags: Optional[List[str]] = None
    request_safety_flags: Optional[List[str]] = None
    execution_results: Optional[List[Dict[str, Any]]] = None
    error_message: Optional[str] = None
    policy_version: Optional[str] = None
    prompt_version: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ClarificationSubmit(BaseModel):
    answers: Dict[str, str]


class ApprovalAction(BaseModel):
    approver_id: str = Field(..., min_length=1)
    reason: Optional[str] = None


class ApprovalResponse(BaseModel):
    request_id: str
    decision: str
    approver_id: str
    reason: Optional[str]
    decided_at: datetime


class AuditLogResponse(BaseModel):
    id: str
    correlation_id: str
    actor: str
    action: str
    input_hash: Optional[str]
    decision: Optional[str]
    metadata_: Optional[Dict[str, Any]] = None
    created_at: datetime
    executed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
    correlation_id: Optional[str] = None
