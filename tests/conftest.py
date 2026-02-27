"""Shared test fixtures."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth.jwt import create_token
from app.db.database import Base, get_db
from app.main import app

# Use a file-based SQLite DB for tests (avoids threading issues with in-memory)
TEST_DATABASE_URL = "sqlite:///./test_ops.db"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    """Create tables before each test, drop after."""
    from app.models.orm import OpsRequest, AuditLog, ApprovalRecord, User  # noqa
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── JWT header helpers ────────────────────────────────────────────────────────

def _bearer(email: str, role: str) -> dict:
    token = create_token({"sub": email, "email": email, "role": role})
    return {"Authorization": f"Bearer {token}"}


REQUESTER_HEADERS = _bearer("alice@acme.com", "requester")
APPROVER_HEADERS = _bearer("bob@acme.com", "approver")
ADMIN_HEADERS = _bearer("charlie@acme.com", "admin")
