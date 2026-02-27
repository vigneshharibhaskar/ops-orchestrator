"""Test JWT authentication: register, login, access control."""
from tests.conftest import REQUESTER_HEADERS, APPROVER_HEADERS


# ── Registration ──────────────────────────────────────────────────────────────

def test_register_returns_token(client):
    resp = client.post("/auth/register", json={
        "email": "newuser@test.com",
        "password": "password123",
        "role": "requester",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["role"] == "requester"


def test_register_duplicate_email_rejected(client):
    body = {"email": "dup@test.com", "password": "password123", "role": "requester"}
    assert client.post("/auth/register", json=body).status_code == 201
    assert client.post("/auth/register", json=body).status_code == 409


def test_register_short_password_rejected(client):
    resp = client.post("/auth/register", json={
        "email": "shortpw@test.com",
        "password": "abc",
        "role": "requester",
    })
    assert resp.status_code == 422


# ── Login ─────────────────────────────────────────────────────────────────────

def test_login_returns_token(client):
    client.post("/auth/register", json={
        "email": "logintest@test.com", "password": "password123", "role": "requester",
    })
    resp = client.post("/auth/login", json={
        "email": "logintest@test.com", "password": "password123",
    })
    assert resp.status_code == 200, resp.text
    assert "access_token" in resp.json()


def test_wrong_password_rejected(client):
    client.post("/auth/register", json={
        "email": "wrongpw@test.com", "password": "password123", "role": "requester",
    })
    resp = client.post("/auth/login", json={
        "email": "wrongpw@test.com", "password": "wrongpassword",
    })
    assert resp.status_code == 401


def test_unknown_email_rejected(client):
    resp = client.post("/auth/login", json={
        "email": "ghost@test.com", "password": "password123",
    })
    assert resp.status_code == 401


# ── Token-protected endpoints ─────────────────────────────────────────────────

def test_protected_endpoint_requires_token(client):
    """No token → 401."""
    resp = client.get("/requests/nonexistent-id")
    assert resp.status_code == 401


def test_invalid_token_rejected(client):
    resp = client.get(
        "/requests/nonexistent-id",
        headers={"Authorization": "Bearer this.is.not.valid"},
    )
    assert resp.status_code == 401


def test_wrong_role_forbidden(client):
    """Requester cannot access the approvals endpoint."""
    resp = client.post(
        "/approvals/fake-id/approve",
        json={"approver_id": "x", "reason": "test reason here"},
        headers=REQUESTER_HEADERS,
    )
    assert resp.status_code == 403


def test_token_from_login_grants_access(client):
    """A token obtained via /auth/login works on protected endpoints."""
    client.post("/auth/register", json={
        "email": "flow@test.com", "password": "password123", "role": "requester",
    })
    login = client.post("/auth/login", json={
        "email": "flow@test.com", "password": "password123",
    })
    token = login.json()["access_token"]
    resp = client.get("/requests", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
