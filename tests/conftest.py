"""Shared test fixtures."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base, get_db
from app.main import app

# Use an in-memory SQLite DB for tests
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
    from app.models.orm import OpsRequest, AuditLog, ApprovalRecord  # noqa
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# Convenience header sets
REQUESTER_HEADERS = {"X-User-ID": "alice@acme.com", "X-User-Role": "requester"}
APPROVER_HEADERS = {"X-User-ID": "bob@acme.com", "X-User-Role": "approver"}
ADMIN_HEADERS = {"X-User-ID": "charlie@acme.com", "X-User-Role": "admin"}
