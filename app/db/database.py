"""SQLAlchemy database setup.

- If DATABASE_URL env var is set, uses Postgres (production / Railway / Render).
- Otherwise falls back to SQLite for local dev.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

_DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./ops_orchestrator.db")

# Railway (and some other hosts) emit postgres:// which SQLAlchemy 1.4+ requires
# as postgresql://.
if _DATABASE_URL.startswith("postgres://"):
    _DATABASE_URL = _DATABASE_URL.replace("postgres://", "postgresql://", 1)

_connect_args = {"check_same_thread": False} if _DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(_DATABASE_URL, connect_args=_connect_args, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency: yields a DB session and closes on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables. Call on startup."""
    from app.models.orm import OpsRequest, AuditLog, ApprovalRecord, User  # noqa: F401
    Base.metadata.create_all(bind=engine)
