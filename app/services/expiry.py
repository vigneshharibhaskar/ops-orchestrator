"""Background expiry checker for time-bounded access grants.

Polls the DB every `interval_seconds` (default 60) for COMPLETED OpsRequests
whose `expires_at` has passed and that haven't been auto-revoked yet, then
fires `orchestrator.auto_revoke()` for each.

Same in-memory/restart trade-off as the ApprovalQueue — acceptable for MVP.
On restart the checker resumes scanning the DB; grants that expired during
downtime are caught on the next poll cycle.
"""
from __future__ import annotations

import threading
from datetime import datetime

from app.db.database import SessionLocal
from app.models.orm import OpsRequest, RequestStatus


def _check_and_revoke() -> None:
    from app.services.orchestrator import auto_revoke

    now = datetime.utcnow()
    db = SessionLocal()
    try:
        expired = (
            db.query(OpsRequest)
            .filter(
                OpsRequest.expires_at.isnot(None),
                OpsRequest.expires_at <= now,
                OpsRequest.status == RequestStatus.COMPLETED,
                OpsRequest.auto_revoked == False,  # noqa: E712
            )
            .all()
        )
        for req in expired:
            try:
                auto_revoke(db, req)
            except Exception as exc:
                # Log and continue — one failure must not block the others
                print(f"[expiry] auto_revoke failed for {req.id}: {exc}")
    finally:
        db.close()


def start_expiry_checker(interval_seconds: int = 60) -> threading.Event:
    """Start the background expiry-checker thread. Returns a stop event."""
    stop_event = threading.Event()

    def run() -> None:
        while not stop_event.wait(interval_seconds):
            try:
                _check_and_revoke()
            except Exception as exc:
                print(f"[expiry] checker error: {exc}")

    thread = threading.Thread(target=run, daemon=True, name="expiry-checker")
    thread.start()
    return stop_event
