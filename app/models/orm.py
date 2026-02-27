"""SQLAlchemy ORM models."""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, JSON, Float, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
import enum

from app.db.database import Base


class RequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    PLANNING = "PLANNING"
    NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTING = "EXECUTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class RiskLevel(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    HUMAN_ONLY = "HUMAN_ONLY"


class OpsRequest(Base):
    __tablename__ = "ops_requests"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    correlation_id = Column(String, unique=True, nullable=False, index=True)
    idempotency_key = Column(String, unique=True, nullable=False, index=True)
    requester_id = Column(String, nullable=False)
    intent = Column(String, nullable=False)
    payload = Column(JSON, nullable=False)
    input_hash = Column(String, nullable=False)
    status = Column(String, default=RequestStatus.PENDING)
    task_plan = Column(JSON, nullable=True)
    risk_level = Column(String, nullable=True)
    risk_score = Column(Float, nullable=True)
    risk_flags = Column(JSON, nullable=True)
    request_safety_flags = Column(JSON, nullable=True)
    execution_results = Column(JSON, nullable=True)
    clarification_answers = Column(JSON, nullable=True)
    policy_version = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    audit_logs = relationship("AuditLog", back_populates="request", cascade="all, delete-orphan")
    approval = relationship("ApprovalRecord", back_populates="request", uselist=False, cascade="all, delete-orphan")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    correlation_id = Column(String, ForeignKey("ops_requests.correlation_id"), nullable=False, index=True)
    actor = Column(String, nullable=False)
    action = Column(String, nullable=False)
    input_hash = Column(String, nullable=True)
    decision = Column(String, nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    executed_at = Column(DateTime, nullable=True)

    request = relationship("OpsRequest", back_populates="audit_logs")


class ApprovalRecord(Base):
    __tablename__ = "approval_records"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    request_id = Column(String, ForeignKey("ops_requests.id"), unique=True, nullable=False)
    approver_id = Column(String, nullable=True)
    decision = Column(String, nullable=True)
    reason = Column(Text, nullable=True)
    queued_at = Column(DateTime, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)

    request = relationship("OpsRequest", back_populates="approval")
