from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
import secrets

from app.auth.dependencies import get_db, get_current_user, require_system_roles
from app.auth.schemas import RegisterRequest, LoginRequest, UserResponse
from app.auth.security import (
    hash_password, verify_password, create_access_token,
    generate_refresh_token, hash_token, COOKIE_SECURE,
    REFRESH_TOKEN_EXPIRE_DAYS
)
from app.models.users import User, RefreshSession

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    from sqlalchemy import func
    normalized_email = req.email.lower()
    existing = db.query(User).filter(func.lower(User.email) == normalized_email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=normalized_email,
        hashed_password=hash_password(req.password),
        system_role="Viewer"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)

@router.post("/login")
def login(req: LoginRequest, response: Response, db: Session = Depends(get_db)):
    from sqlalchemy import func
    normalized_email = req.email.lower()
    user = db.query(User).filter(func.lower(User.email) == normalized_email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access_token = create_access_token(str(user.id), user.system_role)
    raw_refresh = generate_refresh_token()
    refresh_session = RefreshSession(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        revoked=False,
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    )
    db.add(refresh_session)
    db.commit()
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh,
        httponly=True,
        samesite="strict",
        secure=COOKIE_SECURE,
        path="/auth",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400
    )
    response.set_cookie(
        key="csrf_token",
        value=secrets.token_urlsafe(32),
        httponly=False,
        samesite="strict",
        secure=COOKIE_SECURE,
        path="/auth",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return UserResponse.model_validate(user)

@router.post("/refresh")
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    csrf_cookie = request.cookies.get("csrf_token")
    csrf_header = request.headers.get("X-CSRF-Token")
    if not csrf_cookie or not csrf_header:
        raise HTTPException(status_code=403, detail="CSRF validation failed")
    import hmac
    if not hmac.compare_digest(csrf_cookie, csrf_header):
        raise HTTPException(status_code=403, detail="CSRF token mismatch")
    raw_refresh = request.cookies.get("refresh_token")
    if not raw_refresh:
        raise HTTPException(status_code=401, detail="No refresh token")
    token_hash = hash_token(raw_refresh)
    session = db.query(RefreshSession).filter(
        RefreshSession.token_hash == token_hash,
        RefreshSession.revoked == False
    ).first()
    if not session or session.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh session invalid or expired")
    user = db.query(User).filter(User.id == session.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    session.revoked = True
    new_raw = generate_refresh_token()
    new_session = RefreshSession(
        user_id=user.id,
        token_hash=hash_token(new_raw),
        revoked=False,
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    )
    db.add(new_session)
    db.commit()
    new_access = create_access_token(str(user.id), user.system_role)
    response.set_cookie(
        key="refresh_token",
        value=new_raw,
        httponly=True,
        samesite="strict",
        secure=COOKIE_SECURE,
        path="/auth",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400
    )
    return {"access_token": new_access, "token_type": "bearer"}

@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    raw_refresh = request.cookies.get("refresh_token")
    # If a refresh cookie is present, CSRF is required
    if raw_refresh:
        csrf_cookie = request.cookies.get("csrf_token")
        csrf_header = request.headers.get("X-CSRF-Token")
        if not csrf_cookie or not csrf_header:
            raise HTTPException(status_code=403, detail="CSRF validation failed")
        import hmac
        if not hmac.compare_digest(csrf_cookie, csrf_header):
            raise HTTPException(status_code=403, detail="CSRF token mismatch")
        token_hash = hash_token(raw_refresh)
        session = db.query(RefreshSession).filter(RefreshSession.token_hash == token_hash).first()
        if session:
            session.revoked = True
            db.commit()
    else:
        # Idempotent: no refresh cookie means nothing to revoke
        pass
    response.delete_cookie(key="refresh_token", path="/auth")
    response.delete_cookie(key="csrf_token", path="/auth")
    return {"message": "Logged out"}
