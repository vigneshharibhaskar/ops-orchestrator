"""In-memory approval queue (Redis-like mock).

Stores items by request_id. Each item is a dict with the full
request context needed to execute after approval.

In production this would be backed by Redis Streams or a proper queue.
"""
import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional


class ApprovalQueue:
    """Thread-safe in-memory queue for pending approval items."""

    def __init__(self) -> None:
        self._store: Dict[str, Dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def enqueue(self, request_id: str, item: Dict[str, Any]) -> None:
        async with self._lock:
            self._store[request_id] = {
                **item,
                "queued_at": datetime.utcnow().isoformat(),
                "status": "PENDING",
            }

    async def dequeue(self, request_id: str) -> Optional[Dict[str, Any]]:
        """Remove and return the item for the given request_id."""
        async with self._lock:
            return self._store.pop(request_id, None)

    async def peek(self, request_id: str) -> Optional[Dict[str, Any]]:
        async with self._lock:
            return self._store.get(request_id)

    async def list_pending(self) -> List[Dict[str, Any]]:
        async with self._lock:
            return [
                {"request_id": k, **v}
                for k, v in self._store.items()
                if v.get("status") == "PENDING"
            ]

    async def mark(self, request_id: str, status: str) -> bool:
        async with self._lock:
            if request_id not in self._store:
                return False
            self._store[request_id]["status"] = status
            return True

    def __len__(self) -> int:
        return len(self._store)


# Singleton instance shared across the app
approval_queue = ApprovalQueue()
