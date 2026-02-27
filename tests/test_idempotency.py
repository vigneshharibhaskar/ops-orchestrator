"""Test 1: Idempotency — duplicate requests with the same key are rejected."""
import pytest
from tests.conftest import REQUESTER_HEADERS, APPROVER_HEADERS


PAYLOAD = {
    "idempotency_key": "idem-test-001",
    "requester_id": "alice@acme.com",
    "role": "requester",
    "intent": "send_notification",
    "payload": {"channel": "#ops", "message": "Hello"},
}


def test_first_request_succeeds(client):
    """First submission with a unique idempotency_key → 201."""
    resp = client.post("/requests", json=PAYLOAD, headers=REQUESTER_HEADERS)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["idempotency_key"] == "idem-test-001"
    assert data["status"] in ("COMPLETED", "AWAITING_APPROVAL")
    assert "X-Correlation-ID" in resp.headers


def test_duplicate_key_rejected(client):
    """Second submission with same idempotency_key → 409 Conflict."""
    # First request
    resp1 = client.post("/requests", json=PAYLOAD, headers=REQUESTER_HEADERS)
    assert resp1.status_code == 201, resp1.text
    existing_id = resp1.json()["id"]

    # Exact duplicate
    resp2 = client.post("/requests", json=PAYLOAD, headers=REQUESTER_HEADERS)
    assert resp2.status_code == 409, resp2.text
    detail = resp2.json()["detail"]
    assert detail["existing_id"] == existing_id
    assert detail["idempotency_key"] == "idem-test-001"


def test_different_keys_both_succeed(client):
    """Two requests with different idempotency keys are both accepted."""
    payload_a = {**PAYLOAD, "idempotency_key": "idem-unique-a"}
    payload_b = {**PAYLOAD, "idempotency_key": "idem-unique-b"}

    resp_a = client.post("/requests", json=payload_a, headers=REQUESTER_HEADERS)
    resp_b = client.post("/requests", json=payload_b, headers=REQUESTER_HEADERS)

    assert resp_a.status_code == 201, resp_a.text
    assert resp_b.status_code == 201, resp_b.text
    assert resp_a.json()["id"] != resp_b.json()["id"]


def test_requester_role_required(client):
    """Approver role cannot submit requests."""
    resp = client.post("/requests", json=PAYLOAD, headers=APPROVER_HEADERS)
    assert resp.status_code == 403, resp.text
