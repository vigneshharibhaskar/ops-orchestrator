"""Test 2: Approval gating — high-risk requests require explicit approval."""
import pytest
from tests.conftest import REQUESTER_HEADERS, APPROVER_HEADERS, ADMIN_HEADERS


# onboard_user triggers add_to_org (HIGH risk) → must go to approval queue
ONBOARD_PAYLOAD = {
    "idempotency_key": "approval-gate-test-001",
    "requester_id": "alice@acme.com",
    "role": "requester",
    "intent": "onboard_user",
    "payload": {"user_email": "newbie@acme.com", "start_date": "2026-03-01"},
}

# send_notification is LOW risk → auto-executes
NOTIFY_PAYLOAD = {
    "idempotency_key": "approval-gate-test-002",
    "requester_id": "alice@acme.com",
    "role": "requester",
    "intent": "send_notification",
    "payload": {"channel": "#ops", "message": "All good"},
}


def test_high_risk_requires_approval(client):
    """Onboarding (has add_to_org step) → status AWAITING_APPROVAL."""
    resp = client.post("/requests", json=ONBOARD_PAYLOAD, headers=REQUESTER_HEADERS)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "AWAITING_APPROVAL"
    assert data["risk_level"] in ("HIGH", "HUMAN_ONLY")
    assert data["task_plan"]["needs_human_approval"] is True


def test_low_risk_auto_executes(client):
    """Notification-only intent → auto-executes, status COMPLETED."""
    resp = client.post("/requests", json=NOTIFY_PAYLOAD, headers=REQUESTER_HEADERS)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "COMPLETED"
    assert data["execution_results"] is not None


def test_approver_can_approve(client):
    """Valid approver can approve a pending request → COMPLETED."""
    # Submit high-risk request
    resp = client.post("/requests", json=ONBOARD_PAYLOAD, headers=REQUESTER_HEADERS)
    assert resp.status_code == 201
    request_id = resp.json()["id"]

    # Approve it
    approve_resp = client.post(
        f"/approvals/{request_id}/approve",
        json={"approver_id": "bob@acme.com", "reason": "Looks good"},
        headers=APPROVER_HEADERS,
    )
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json()["decision"] == "APPROVED"

    # Verify final state
    get_resp = client.get(f"/requests/{request_id}", headers=APPROVER_HEADERS)
    assert get_resp.json()["status"] == "COMPLETED"
    assert get_resp.json()["execution_results"] is not None


def test_requester_cannot_approve(client):
    """Requester role is forbidden from approving — must be approver or admin."""
    resp = client.post("/requests", json=ONBOARD_PAYLOAD, headers=REQUESTER_HEADERS)
    request_id = resp.json()["id"]

    approve_resp = client.post(
        f"/approvals/{request_id}/approve",
        json={"approver_id": "alice@acme.com", "reason": "Self-approval attempt"},
        headers=REQUESTER_HEADERS,  # wrong role
    )
    assert approve_resp.status_code == 403


def test_approver_can_reject(client):
    """Approver can reject a pending request → REJECTED."""
    payload = {**ONBOARD_PAYLOAD, "idempotency_key": "approval-reject-test"}
    resp = client.post("/requests", json=payload, headers=REQUESTER_HEADERS)
    request_id = resp.json()["id"]

    reject_resp = client.post(
        f"/approvals/{request_id}/reject",
        json={"approver_id": "bob@acme.com", "reason": "Policy violation"},
        headers=APPROVER_HEADERS,
    )
    assert reject_resp.status_code == 200
    assert reject_resp.json()["decision"] == "REJECTED"

    get_resp = client.get(f"/requests/{request_id}", headers=APPROVER_HEADERS)
    assert get_resp.json()["status"] == "REJECTED"


def test_double_approve_rejected(client):
    """Approving an already-approved request → 409."""
    payload = {**ONBOARD_PAYLOAD, "idempotency_key": "double-approve-test"}
    resp = client.post("/requests", json=payload, headers=REQUESTER_HEADERS)
    request_id = resp.json()["id"]

    client.post(
        f"/approvals/{request_id}/approve",
        json={"approver_id": "bob@acme.com"},
        headers=APPROVER_HEADERS,
    )
    second = client.post(
        f"/approvals/{request_id}/approve",
        json={"approver_id": "bob@acme.com"},
        headers=APPROVER_HEADERS,
    )
    assert second.status_code == 409
