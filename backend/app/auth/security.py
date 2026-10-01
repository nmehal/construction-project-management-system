import os
from datetime import datetime, timezone, timedelta
from typing import Optional
import secrets
import hashlib
import pwdlib
import jwt

from sqlalchemy.orm import Session
from app.models.users import User, RefreshSession

pwd_context = pwdlib.PasswordHash.recommended()

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)

AUTH_SECRET = os.getenv("AUTH_SECRET")
if not AUTH_SECRET or len(AUTH_SECRET) < 16:
    raise RuntimeError("AUTH_SECRET must be set and have at least 16 characters")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

def create_access_token(sub: str, role: str) -> str:
    payload = {
        "sub": sub,
        "type": "access",
        "role": role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, AUTH_SECRET, algorithm="HS256")

def verify_access_token(token: str) -> dict:
    payload = jwt.decode(token, AUTH_SECRET, algorithms=["HS256"])
    if payload.get("type") != "access":
        raise ValueError("Invalid token type")
    return payload

def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
