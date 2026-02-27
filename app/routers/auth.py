"""POST /auth/register and POST /auth/login"""
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.jwt import create_token
from app.db import get_db
from app.models.orm import User
from app.models.schemas import LoginRequest, RegisterRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user and return a JWT."""
    if db.query(User).filter_by(email=body.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=body.email,
        password_hash=_hash(body.password),
        role=body.role.value,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_token({"sub": user.id, "email": user.email, "role": user.role})
    return TokenResponse(access_token=token, token_type="bearer", role=user.role)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Exchange email + password for a JWT."""
    user = db.query(User).filter_by(email=body.email).first()
    if not user or not _verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token({"sub": user.id, "email": user.email, "role": user.role})
    return TokenResponse(access_token=token, token_type="bearer", role=user.role)
