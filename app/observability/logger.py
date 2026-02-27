"""Structured audit logger.

Writes to the audit_logs DB table and also emits structured JSON
lines to stdout for easy log aggregation.
"""
import json
import logging
import sys
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.orm import AuditLog


# ── Structured stdout logger ──────────────────────────────────────────────────

class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log = {
            "ts": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        if hasattr(record, "extra"):
            log.update(record.extra)
        return json.dumps(log)


def _build_logger() -> logging.Logger:
    logger = logging.getLogger("ops_orchestrator")
    if logger.handlers:
        return logger
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


logger = _build_logger()


# ── Audit DB writer ───────────────────────────────────────────────────────────

def audit(
    db: Session,
    *,
    correlation_id: str,
    actor: str,
    action: str,
    input_hash: Optional[str] = None,
    decision: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    executed_at: Optional[datetime] = None,
) -> AuditLog:
    """Persist an audit record and emit a structured log line."""
    entry = AuditLog(
        correlation_id=correlation_id,
        actor=actor,
        action=action,
        input_hash=input_hash,
        decision=decision,
        metadata_=metadata or {},
        created_at=datetime.utcnow(),
        executed_at=executed_at or datetime.utcnow(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    logger.info(
        action,
        extra={
            "correlation_id": correlation_id,
            "actor": actor,
            "action": action,
            "decision": decision,
            "input_hash": input_hash,
        },
    )
    return entry
