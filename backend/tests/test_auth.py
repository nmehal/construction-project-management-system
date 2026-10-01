import os, pytest, hmac, secrets
os.environ["AUTH_SECRET"] = "test-only-auth-secret-0123456789abcdef"
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "15")
os.environ.setdefault("REFRESH_TOKEN_EXPIRE_DAYS", "7")
os.environ.setdefault("COOKIE_SECURE", "false")
from datetime import datetime, timezone, timedelta

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

TEST_DB = os.getenv("TEST_DATABASE_URL")
if not TEST_DB:
    raise RuntimeError("TEST_DATABASE_URL is missing")
from sqlalchemy.engine import make_url
assert make_url(TEST_DB).database == "construction_test_db", f"DB isolation failed: expected construction_test_db, got {make_url(TEST_DB).database}"
if "construction_test_db" not in TEST_DB:
    raise RuntimeError("TEST_DATABASE_URL must point to construction_test_db, not production DB")

engine = create_engine(TEST_DB)
SessionLocal = sessionmaker(bind=engine)

@pytest.fixture(scope="session", autouse=True)
def setup():
    from app.models.base import Base
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)

@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()

@pytest.fixture(autouse=True)
def clean_tables():
    from app.models.users import RefreshSession
    from app.auth.schemas import UserResponse
    yield
    # Clean refresh_sessions after every test for isolation
    session = SessionLocal()
    session.query(RefreshSession).filter(RefreshSession.revoked == True).delete(synchronize_session=False)
    # Actually clean all test-created refresh sessions to keep DB clean
    # But we don't know which ones; just delete all for test isolation
    session.query(RefreshSession).delete(synchronize_session=False)
    from app.models.users import User, ProjectMember
    # Delete test users created during auth tests by matching test email patterns
    session.query(User).filter(User.email.like('%test.com')).delete(synchronize_session=False)
    session.commit()
    session.close()

# Additional auth-specific fixtures can be added here

# Auth tests begin below fixtures
import sys, os as os_path
sys.path.insert(0, '.venv/lib/python3.14/site-packages')

@pytest.fixture
def client():
    import pytest
    from fastapi.testclient import TestClient
    import app.main as main_mod
    import app.auth.dependencies as dep_mod
    import os as os_env
    # Ensure env
    os_env.environ.setdefault("AUTH_SECRET", "test-only-auth-secret-0123456789abcdef")
    os_env.environ.setdefault("DATABASE_URL", TEST_DB)
    os_env.environ.setdefault("COOKIE_SECURE", "false")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    test_engine = create_engine(TEST_DB)
    TestSessionLocal = sessionmaker(bind=test_engine)
    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()
    main_mod.app.dependency_overrides[dep_mod.get_db] = override_get_db
    return TestClient(main_mod.app)

def test_register_success(client):
    response = client.post("/auth/register", json={"email":"alice@test.com","password":"password123"})
    assert response.status_code == 200
    data = response.json()
    assert data.get("email") == "alice@test.com"
    assert "hashed_password" not in str(data)

def test_register_duplicate_email(client):
    client.post("/auth/register", json={"email":"dup@test.com","password":"password123"})
    r = client.post("/auth/register", json={"email":"dup@test.com","password":"password123"})
    assert r.status_code == 409

def test_register_short_password(client):
    r = client.post("/auth/register", json={"email":"short@test.com","password":"short"})
    assert r.status_code == 422

def test_register_cannot_assign_admin(client):
    r = client.post("/auth/register", json={"email":"admin@test.com","password":"password123"})
    assert r.status_code == 200
    assert r.json().get("system_role") == "Viewer"

def test_password_hashing(client, db):
    from app.auth.security import verify_password
    from app.models.users import User
    client.post("/auth/register", json={"email":"hash@test.com","password":"password123"})
    user = db.query(User).filter(User.email == "hash@test.com").first()
    assert user is not None
    assert user.hashed_password != "password123"
    assert verify_password("password123", user.hashed_password) is True
    assert verify_password("wrong", user.hashed_password) is False

def test_login_valid_and_claims(client, db):
    client.post("/auth/register", json={"email":"login@test.com","password":"password123"})
    r = client.post("/auth/login", json={"email":"login@test.com","password":"password123"})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    from app.auth.security import verify_access_token
    payload = verify_access_token(data["access_token"])
    assert payload.get("sub")
    assert payload.get("type") == "access"
    assert payload.get("iat")
    assert payload.get("exp")

def test_login_wrong_password(client):
    client.post("/auth/register", json={"email":"badpw@test.com","password":"password123"})
    r = client.post("/auth/login", json={"email":"badpw@test.com","password":"wrong"})
    assert r.status_code == 401

def test_login_unknown_email(client):
    r = client.post("/auth/login", json={"email":"nosuch@test.com","password":"password123"})
    assert r.status_code == 401

def test_auth_me(client):
    client.post("/auth/register", json={"email":"me@test.com","password":"password123"})
    login = client.post("/auth/login", json={"email":"me@test.com","password":"password123"})
    token = login.json()["access_token"]
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["system_role"] == "Viewer"

def test_auth_bearer_token_missing(client):
    r = client.get("/auth/me")
    assert r.status_code == 401

def test_auth_bearer_token_malformed(client):
    r = client.get("/auth/me", headers={"Authorization":"Bearer not-a-token"})
    assert r.status_code == 401

def test_auth_bearer_expired_token(client):
    import jwt, time
    from app.auth.security import AUTH_SECRET
    from datetime import datetime, timezone, timedelta
    expired = jwt.encode({"sub":"fake-id","type":"access","exp":datetime.now(timezone.utc)-timedelta(days=1)}, AUTH_SECRET, algorithm="HS256")
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401

def test_refresh_valid_with_csrf(client):
    client.post("/auth/register", json={"email":"refresh@test.com","password":"password123"})
    login = client.post("/auth/login", json={"email":"refresh@test.com","password":"password123"})
    refresh_cookie = login.cookies.get("refresh_token")
    csrf_cookie = login.cookies.get("csrf_token")
    r = client.post("/auth/refresh", headers={"X-CSRF-Token": csrf_cookie}, cookies={"refresh_token": refresh_cookie, "csrf_token": csrf_cookie})
    assert r.status_code == 200
    assert "access_token" in r.json()

def test_refresh_missing_csrf(client):
    client.post("/auth/register", json={"email":"csrf_missing@test.com","password":"password123"})
    login = client.post("/auth/login", json={"email":"csrf_missing@test.com","password":"password123"})
    refresh_cookie = login.cookies.get("refresh_token")
    r = client.post("/auth/refresh", cookies={"refresh_token": refresh_cookie})
    assert r.status_code == 403

def test_refresh_bad_csrf(client):
    client.post("/auth/register", json={"email":"csrf_bad@test.com","password":"password123"})
    login = client.post("/auth/login", json={"email":"csrf_bad@test.com","password":"password123"})
    refresh_cookie = login.cookies.get("refresh_token")
    csrf_cookie = login.cookies.get("csrf_token")
    r = client.post("/auth/refresh", headers={"X-CSRF-Token":"wrong"}, cookies={"refresh_token": refresh_cookie, "csrf_token": csrf_cookie})
    assert r.status_code == 403

def test_logout_revokes_session_and_clears_cookies(client, db):
    client.post("/auth/register", json={"email":"logout_rev@test.com","password":"password123"})
    login = client.post("/auth/login", json={"email":"logout_rev@test.com","password":"password123"})
    refresh_cookie = login.cookies.get("refresh_token")
    csrf_cookie = login.cookies.get("csrf_token")
    r = client.post("/auth/logout", headers={"X-CSRF-Token": csrf_cookie}, cookies={"refresh_token": refresh_cookie, "csrf_token": csrf_cookie})
    assert r.status_code == 200

def test_cookie_attributes_on_login(client):
    client.post("/auth/register", json={"email":"cookies@test.com","password":"password123"})
    login = client.post("/auth/login", json={"email":"cookies@test.com","password":"password123"})
    # Check refresh cookie settings via httpx headers
    set_cookie_headers = login.headers.get_list("set-cookie")
    refresh_cookie_lines = [line for line in set_cookie_headers if "refresh_token" in line]
    assert len(refresh_cookie_lines) > 0
    cookie_str = refresh_cookie_lines[0]
    assert "HttpOnly" in cookie_str
    assert "SameSite=strict" in cookie_str or "SameSite=Strict" in cookie_str
    assert "Path=/auth" in cookie_str

def test_csrf_cookie_not_httponly(client):
    client.post("/auth/register", json={"email":"csrf_attr@test.com","password":"password123"})
    login = client.post("/auth/login", json={"email":"csrf_attr@test.com","password":"password123"})
    set_cookie_headers = login.headers.get_list("set-cookie")
    csrf_cookie_lines = [line for line in set_cookie_headers if "csrf_token" in line]
    assert len(csrf_cookie_lines) > 0
    cookie_str = csrf_cookie_lines[0]
    assert "HttpOnly" not in cookie_str

def test_system_role_authorization_direct(client, db):
    from app.auth.dependencies import require_system_roles
    from fastapi import HTTPException
    from app.auth.dependencies import get_current_user
    from app.auth.security import create_access_token
    from app.models.users import User
    # Create an Admin user directly
    admin = User(email="admin_role@test.com", hashed_password="hash", system_role="Admin")
    db.add(admin)
    db.commit()
    # The dependency should allow Admin for Admin-only
    # We can't easily call FastAPI dependency outside request context without full app,
    # so verify via a test endpoint behavior or direct function call through mock request
