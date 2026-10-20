"""Stage 5 claims endpoint tests; fictional Australian projects only."""

import os
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, delete, make_url
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base, BudgetCategory, ProgressClaim, Project, ProjectMember,
    RefreshSession, Subcontractor, User, Variation,
)


TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    raise RuntimeError("TEST_DATABASE_URL is required")
TEST_URL = make_url(TEST_DATABASE_URL)
assert TEST_URL.database == "construction_test_db"
assert TEST_URL.get_backend_name() == "postgresql"
TEST_AUTH_SECRET = "stage5-test-only-auth-secret-not-for-production-0123456789"
os.environ.setdefault("AUTH_SECRET", TEST_AUTH_SECRET)
os.environ.setdefault("COOKIE_SECURE", "false")
CLAIM_DATE = "2026-01-15T00:00:00+00:00"


@pytest.fixture
def test_engine():
    engine = create_engine(TEST_DATABASE_URL)
    try:
        Base.metadata.create_all(engine)
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def db(test_engine):
    session = sessionmaker(bind=test_engine)()
    session.info["project_ids"] = []
    session.info["user_ids"] = []
    try:
        yield session
    finally:
        session.rollback()
        project_ids = session.info["project_ids"]
        user_ids = session.info["user_ids"]
        try:
            for model in (ProgressClaim, Variation, Subcontractor, BudgetCategory):
                session.execute(delete(model).where(model.project_id.in_(project_ids)))
            session.execute(delete(ProjectMember).where(
                (ProjectMember.project_id.in_(project_ids))
                | (ProjectMember.user_id.in_(user_ids))
            ))
            session.execute(delete(Project).where(Project.id.in_(project_ids)))
            session.execute(delete(RefreshSession).where(RefreshSession.user_id.in_(user_ids)))
            session.execute(delete(User).where(User.id.in_(user_ids)))
            session.commit()
        finally:
            session.close()


@pytest.fixture
def client(db, test_engine, monkeypatch):
    # App import requires DATABASE_URL; assign ONLY the validated test URL.
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("AUTH_SECRET", TEST_AUTH_SECRET)
    monkeypatch.setenv("COOKIE_SECURE", "false")
    from fastapi.testclient import TestClient
    from app.auth.dependencies import get_db
    from app.main import app

    request_sessions = sessionmaker(bind=test_engine)

    def override_get_db():
        with request_sessions() as session:
            yield session

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def make_user(db, system_role="Viewer"):
    from app.auth.security import hash_password

    user_id = uuid4()
    db.info["user_ids"].append(user_id)
    user = User(
        id=user_id,
        email=f"claims-{user_id.hex}@example.com",
        hashed_password=hash_password("password123"),
        system_role=system_role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_project(db, name="Fictional Banksia Renovation"):
    project_id = uuid4()
    db.info["project_ids"].append(project_id)
    now = datetime.now(timezone.utc)
    project = Project(
        id=project_id, name=name, client="Fictional Banksia Household",
        suburb="Ballarat", status="Active", contract_value=Decimal("250000.00"),
        is_archived=False, created_at=now, updated_at=now,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def add_member(db, project, user, role):
    db.add(ProjectMember(project_id=project.id, user_id=user.id, project_role=role))
    db.commit()


def login(client, user):
    response = client.post("/auth/login", json={
        "email": user.email, "password": "password123",
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["token_type"] == "bearer"
    assert isinstance(data["access_token"], str) and data["access_token"]
    return {"Authorization": f"Bearer {data['access_token']}"}


def actor_headers(client, db, project, role):
    if role == "Admin":
        # Deliberately no membership: Admin may access any project.
        user = make_user(db, "Admin")
    else:
        # A global Project Manager role must NOT bypass project permissions.
        system_role = "Project Manager" if role in ("Contributor", "Non-member") else "Viewer"
        user = make_user(db, system_role)
        if role != "Non-member":
            add_member(db, project, user, role)
    return login(client, user)


def payload(**changes):
    data = {
        "claim_no": "PC-001", "stage": "Frame complete", "date": CLAIM_DATE,
        "amount": "1000.50", "status": "Issued",
    }
    data.update(changes)
    return data


def assert_claim(data, project, expected):
    assert UUID(data["id"])
    assert data["project_id"] == str(project.id)
    assert data["claim_no"] == expected["claim_no"]
    assert data["stage"] == expected["stage"]
    assert datetime.fromisoformat(data["date"]) == datetime.fromisoformat(expected["date"])
    assert isinstance(data["amount"], str)
    assert Decimal(data["amount"]) == Decimal(expected["amount"])
    assert data["status"] == expected["status"]


def create_claim(client, project, headers, **changes):
    expected = payload(**changes)
    response = client.post(f"/projects/{project.id}/claims", headers=headers, json=expected)
    assert response.status_code == 200, response.text
    data = response.json()
    assert_claim(data, project, expected)
    return data


def existing_claim(client, db):
    project = make_project(db)
    admin_headers = actor_headers(client, db, project, "Admin")
    claim = create_claim(client, project, admin_headers)
    return project, claim, admin_headers


def assert_create_allowed(client, db, role):
    project = make_project(db)
    headers = actor_headers(client, db, project, role)
    data = create_claim(client, project, headers)
    saved = db.get(ProgressClaim, UUID(data["id"]))
    assert saved.project_id == project.id
    assert saved.amount == Decimal("1000.50")
    assert saved.status == "Issued"
    assert saved.paid_date is None


def assert_create_denied(client, db, role):
    project = make_project(db)
    headers = actor_headers(client, db, project, role)
    response = client.post(f"/projects/{project.id}/claims", headers=headers, json=payload())
    assert response.status_code == 403
    assert response.json() == {"detail": "Access denied"}
    assert db.query(ProgressClaim).filter_by(project_id=project.id).count() == 0


def assert_list_allowed(client, db, role):
    project, claim, admin_headers = existing_claim(client, db)
    other = make_project(db, "Fictional Wattle Extension")
    create_claim(client, other, admin_headers, claim_no="OTHER-001")
    headers = admin_headers if role == "Admin" else actor_headers(client, db, project, role)
    response = client.get(f"/projects/{project.id}/claims", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == [claim]


def assert_read_allowed(client, db, role):
    project, claim, _ = existing_claim(client, db)
    headers = actor_headers(client, db, project, role)
    response = client.get(f"/projects/{project.id}/claims/{claim['id']}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == claim


def assert_update_allowed(client, db, role):
    project, claim, admin_headers = existing_claim(client, db)
    headers = admin_headers if role == "Admin" else actor_headers(client, db, project, role)
    response = client.patch(
        f"/projects/{project.id}/claims/{claim['id']}", headers=headers,
        json={"amount": "1250.75"},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {**claim, "amount": "1250.75"}
    db.expire_all()
    saved = db.get(ProgressClaim, UUID(claim["id"]))
    assert saved.amount == Decimal("1250.75")
    assert saved.claim_no == claim["claim_no"]
    assert saved.date == datetime.fromisoformat(claim["date"])


def assert_update_denied(client, db, role):
    project, claim, _ = existing_claim(client, db)
    headers = actor_headers(client, db, project, role)
    response = client.patch(
        f"/projects/{project.id}/claims/{claim['id']}", headers=headers,
        json={"amount": "1250.75"},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "Access denied"}
    db.expire_all()
    assert db.get(ProgressClaim, UUID(claim["id"])).amount == Decimal("1000.50")


def test_claim_create_admin(client, db):
    assert_create_allowed(client, db, "Admin")


def test_claim_create_manager(client, db):
    assert_create_allowed(client, db, "Manager")


def test_claim_create_contributor_denied(client, db):
    assert_create_denied(client, db, "Contributor")


def test_claim_create_viewer_denied(client, db):
    assert_create_denied(client, db, "Viewer")


def test_claim_create_non_member_denied(client, db):
    assert_create_denied(client, db, "Non-member")


def test_claim_list_admin(client, db):
    assert_list_allowed(client, db, "Admin")


def test_claim_list_manager(client, db):
    assert_list_allowed(client, db, "Manager")


def test_claim_list_contributor(client, db):
    assert_list_allowed(client, db, "Contributor")


def test_claim_list_viewer(client, db):
    assert_list_allowed(client, db, "Viewer")


def test_claim_list_non_member_denied(client, db):
    project, _, _ = existing_claim(client, db)
    headers = actor_headers(client, db, project, "Non-member")
    response = client.get(f"/projects/{project.id}/claims", headers=headers)
    assert response.status_code == 403
    assert response.json() == {"detail": "Access denied"}


def test_claim_read_manager(client, db):
    assert_read_allowed(client, db, "Manager")


def test_claim_read_contributor(client, db):
    assert_read_allowed(client, db, "Contributor")


def test_claim_read_viewer(client, db):
    assert_read_allowed(client, db, "Viewer")


def test_claim_read_non_member_denied(client, db):
    project, claim, _ = existing_claim(client, db)
    headers = actor_headers(client, db, project, "Non-member")
    response = client.get(f"/projects/{project.id}/claims/{claim['id']}", headers=headers)
    assert response.status_code == 403
    assert response.json() == {"detail": "Access denied"}


def test_claim_update_admin(client, db):
    assert_update_allowed(client, db, "Admin")


def test_claim_update_manager(client, db):
    assert_update_allowed(client, db, "Manager")


def test_claim_update_contributor_denied(client, db):
    assert_update_denied(client, db, "Contributor")


def test_claim_update_viewer_denied(client, db):
    assert_update_denied(client, db, "Viewer")


def test_claim_invalid_status_create(client, db):
    project = make_project(db)
    headers = actor_headers(client, db, project, "Admin")
    response = client.post(
        f"/projects/{project.id}/claims", headers=headers, json=payload(status="Approved"),
    )
    assert response.status_code == 422
    assert any(error["loc"] == ["body", "status"] and error["type"] == "literal_error"
               for error in response.json()["detail"])
    assert db.query(ProgressClaim).filter_by(project_id=project.id).count() == 0


def test_claim_invalid_status_update(client, db):
    project, claim, headers = existing_claim(client, db)
    response = client.patch(
        f"/projects/{project.id}/claims/{claim['id']}", headers=headers,
        json={"status": "Approved"},
    )
    assert response.status_code == 422
    assert any(error["loc"] == ["body", "status"] and error["type"] == "literal_error"
               for error in response.json()["detail"])
    db.expire_all()
    assert db.get(ProgressClaim, UUID(claim["id"])).status == "Issued"


def test_claim_cross_project_not_exposed(client, db):
    project_a, claim, _ = existing_claim(client, db)
    project_b = make_project(db, "Fictional Wattle Extension")
    manager = make_user(db, "Viewer")
    add_member(db, project_a, manager, "Manager")
    add_member(db, project_b, manager, "Manager")
    headers = login(client, manager)
    own = client.get(f"/projects/{project_a.id}/claims/{claim['id']}", headers=headers)
    assert own.status_code == 200
    assert own.json() == claim
    readable = client.get(f"/projects/{project_b.id}/claims", headers=headers)
    assert readable.status_code == 200
    assert readable.json() == []
    wrong_url = f"/projects/{project_b.id}/claims/{claim['id']}"
    response = client.get(wrong_url, headers=headers)
    assert response.status_code == 404
    assert response.json() == {"detail": "Claim not found"}
    update = client.patch(wrong_url, headers=headers, json={"amount": "1250.75"})
    assert update.status_code == 404
    assert update.json() == {"detail": "Claim not found"}
    db.expire_all()
    saved = db.get(ProgressClaim, UUID(claim["id"]))
    assert saved.project_id == project_a.id
    assert saved.amount == Decimal("1000.50")


def test_claim_decimal_amount_exactness(client, db):
    project = make_project(db)
    headers = actor_headers(client, db, project, "Admin")
    claim = create_claim(client, project, headers, amount="100.10")
    assert claim["amount"] == "100.10"
    saved = db.get(ProgressClaim, UUID(claim["id"]))
    assert isinstance(saved.amount, Decimal)
    assert saved.amount == Decimal("100.10")
    response = client.get(f"/projects/{project.id}/claims/{claim['id']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["amount"] == "100.10"


def test_claim_paid_create_auto_date(client, db):
    project = make_project(db)
    headers = actor_headers(client, db, project, "Admin")
    before = datetime.now(timezone.utc)
    claim = create_claim(client, project, headers, status="Paid")
    after = datetime.now(timezone.utc)
    assert claim["paid_date"] is not None
    paid_date = datetime.fromisoformat(claim["paid_date"])
    assert paid_date.tzinfo is not None
    assert before <= paid_date <= after
    saved = db.get(ProgressClaim, UUID(claim["id"]))
    assert saved.status == "Paid"
    assert saved.paid_date == paid_date


def test_claim_paid_update_auto_date(client, db):
    project, claim, headers = existing_claim(client, db)
    assert claim["status"] == "Issued"
    assert claim["paid_date"] is None
    before = datetime.now(timezone.utc)
    response = client.patch(
        f"/projects/{project.id}/claims/{claim['id']}", headers=headers,
        json={"status": "Paid"},
    )
    after = datetime.now(timezone.utc)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["paid_date"] is not None
    assert data == {**claim, "status": "Paid", "paid_date": data["paid_date"]}
    paid_date = datetime.fromisoformat(data["paid_date"])
    assert paid_date.tzinfo is not None
    assert before <= paid_date <= after
    db.expire_all()
    saved = db.get(ProgressClaim, UUID(claim["id"]))
    assert saved.status == "Paid"
    assert saved.paid_date == paid_date
