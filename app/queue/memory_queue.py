"""In-memory approval queue.

Stores pending approval items by request_id. Each item is a dict with the
full request context needed for execution after approval.

In production this would be backed by Redis Streams or a proper durable queue.
"""
import asyncio
from datetime import datetime
from typing import Any, Dict


class ApprovalQueue:
    """In-memory store for pending approval payloads."""

    def __init__(self) -> None:
        self._store: Dict[str, Dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def enqueue(self, request_id: str, item: Dict[str, Any]) -> None:
        async with self._lock:
            self._store[request_id] = {
                **item,
                "queued_at": datetime.utcnow().isoformat(),
            }

    def __len__(self) -> int:
        return len(self._store)


# Singleton instance shared across the app
approval_queue = ApprovalQueue()
