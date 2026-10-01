import os
from fastapi import Depends, HTTPException, status, Request, Header
from sqlalchemy.orm import Session
from typing import Optional

from app.auth.security import verify_access_token, AUTH_SECRET
from app.models.users import User
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing. Set it in the environment (e.g., .env)")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(db: Session = Depends(get_db), authorization: Optional[str] = Header(None)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = authorization.replace("Bearer ", "")
    try:
        payload = verify_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Load current system_role from DB, not JWT claim
    return user

def require_system_roles(*roles: str):
    def checker(user: User = Depends(get_current_user)):
        if user.system_role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient privileges")
        return user
    return checker
