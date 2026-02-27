"""FastAPI application entrypoint."""
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.db import init_db
from app.routers import requests as requests_router
from app.routers import approvals as approvals_router
from app.routers import demo as demo_router
from app.routers import auth as auth_router


def _seed_users() -> None:
    """Create default dev users if the users table is empty.

    DEV ONLY — passwords are hardcoded. Set real credentials via env in production.
    """
    import bcrypt
    from app.db.database import SessionLocal
    from app.models.orm import User

    _SEED = [
        ("alice@acme-fintech.com", "password123", "requester"),
        ("compliance@acme-fintech.com", "password123", "approver"),
        ("admin@acme-fintech.com", "password123", "admin"),
    ]

    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            for email, password, role in _SEED:
                pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
                db.add(User(email=email, password_hash=pw_hash, role=role))
            db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize DB tables and seed dev users on startup."""
    init_db()
    _seed_users()
    yield


app = FastAPI(
    title="Ops Orchestrator",
    description=(
        "AI-native ops orchestration: submit requests, generate task plans via Claude, "
        "apply deterministic risk gating, auto-execute low-risk steps, and route "
        "high-risk steps through a human approval queue."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(requests_router.router)
app.include_router(approvals_router.router)
app.include_router(demo_router.router)


# ── Middleware: inject X-Correlation-ID on every response ─────────────────────
@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    response = await call_next(request)
    if "X-Correlation-ID" not in response.headers:
        response.headers["X-Correlation-ID"] = request.headers.get(
            "X-Correlation-ID", str(uuid.uuid4())
        )
    return response


# ── Global exception handler ───────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc),
            "correlation_id": request.headers.get("X-Correlation-ID"),
        },
    )


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "service": "ops-orchestrator"}
