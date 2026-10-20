"""Stage 6A HTTP/real-PostgreSQL contracts; all seeded entities are fictional.

Collection validates only TEST_DATABASE_URL. No application import, connection,
DDL, login, or data mutation takes place until fixtures execute.
"""

import os
from datetime import datetime, timezone
from decimal import Decimal
from http.cookies import SimpleCookie
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
    raise RuntimeError("TEST_DATABASE_URL is required; no DATABASE_URL fallback is permitted")
TEST_URL = make_url(TEST_DATABASE_URL)
if TEST_URL.database != "construction_test_db" or TEST_URL.get_backend_name() != "postgresql":
    raise RuntimeError("TEST_DATABASE_URL must point to PostgreSQL database construction_test_db")
TEST_AUTH_SECRET = "stage6a-test-only-auth-secret-not-for-production-0123456789"
PASSWORD = "fictional-contract-password-123"


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
            # Include API-created projects belonging to our tracked creators even
            # if response validation failed after the API committed the insert.
            created_ids = session.query(ProjectMember.project_id).filter(
                ProjectMember.user_id.in_(user_ids)
            ).all()
            project_ids = list(set(project_ids) | {row[0] for row in created_ids})
            for model in (ProgressClaim, Variation, Subcontractor, BudgetCategory):
                session.execute(delete(model).where(model.project_id.in_(project_ids)))
            session.execute(delete(ProjectMember).where(
                ProjectMember.project_id.in_(project_ids)
                | ProjectMember.user_id.in_(user_ids)
            ))
            session.execute(delete(Project).where(Project.id.in_(project_ids)))
            session.execute(delete(RefreshSession).where(RefreshSession.user_id.in_(user_ids)))
            session.execute(delete(User).where(User.id.in_(user_ids)))
            session.commit()
        finally:
            session.close()


@pytest.fixture
def cookie_secure():
    return False


@pytest.fixture
def client(db, test_engine, monkeypatch, cookie_secure):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("AUTH_SECRET", TEST_AUTH_SECRET)
    monkeypatch.setenv("COOKIE_SECURE", str(cookie_secure).lower())
    from fastapi.testclient import TestClient
    from app.auth import security, routes
    from app.auth.dependencies import get_db
    from app.main import app

    # Configuration only: also isolate constants if another test imported the
    # app first. Password hashing, JWT verification, CSRF and SQL remain real.
    monkeypatch.setattr(security, "AUTH_SECRET", TEST_AUTH_SECRET)
    monkeypatch.setattr(security, "COOKIE_SECURE", cookie_secure)
    monkeypatch.setattr(routes, "COOKIE_SECURE", cookie_secure)
    request_sessions = sessionmaker(bind=test_engine)

    def override_get_db():
        with request_sessions() as session:
            yield session

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app, base_url="https://testserver") as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def make_user(db, system_role="Viewer"):
    from app.auth.security import hash_password

    user_id = uuid4()
    db.info["user_ids"].append(user_id)
    user = User(id=user_id, email=f"contracts-{user_id.hex}@example.com",
                hashed_password=hash_password(PASSWORD), system_role=system_role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_project(db):
    project_id = uuid4()
    db.info["project_ids"].append(project_id)
    now = datetime.now(timezone.utc)
    project = Project(
        id=project_id, name="Fictional Banksia Extension", client="Fictional Household",
        suburb="Ballarat", status="On Hold", contract_value=Decimal("250000.15"),
        start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 12, 1, tzinfo=timezone.utc),
        forecast_uncommitted_costs=Decimal("12345.67"), is_archived=False,
        created_at=now, updated_at=now,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def login(client, user):
    response = client.post("/auth/login", json={"email": user.email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["token_type"] == "bearer"
    assert isinstance(data["access_token"], str) and data["access_token"]
    return response, {"Authorization": f"Bearer {data['access_token']}"}


def actor(client, db, project, system_role, project_role):
    user = make_user(db, system_role)
    if project_role is not None:
        db.add(ProjectMember(project_id=project.id, user_id=user.id, project_role=project_role))
        db.commit()
    return login(client, user)[1]


# Explicit truth table, independent of the implementation's permission helpers.
# Columns: read, manage, variation-create, variation-update, sub-create,
# sub-update, claim-create, claim-update, archive.
CAPABILITY_KEYS = (
    "can_read", "can_manage_project", "can_create_variations", "can_update_variations",
    "can_create_subcontractors", "can_update_subcontractors", "can_create_claims",
    "can_update_claims", "can_archive_project",
)
ROLE_CASES = [
    ("Admin", None, (True, True, True, True, True, True, True, True, True)),
    ("Admin", "Viewer", (True, True, True, True, True, True, True, True, True)),
    ("Viewer", "Manager", (True, True, True, True, True, True, True, True, True)),
    ("Viewer", "Contributor", (True, False, True, False, False, False, False, False, False)),
    ("Viewer", "Viewer", (True, False, False, False, False, False, False, False, False)),
    ("Project Manager", "Contributor", (True, False, True, True, True, True, False, False, False)),
    ("Project Manager", "Viewer", (True, False, True, True, True, True, False, False, False)),
    ("Project Manager", None, (False, False, False, False, False, False, False, False, False)),
]


def assert_capabilities(data, role, values):
    assert "project_role" in data
    assert data["project_role"] == role
    assert data["capabilities"] == dict(zip(CAPABILITY_KEYS, values))
    assert all(type(value) is bool for value in data["capabilities"].values())


@pytest.mark.parametrize("system_role,project_role,values", ROLE_CASES)
def test_project_list_and_detail_capability_contract(client, db, system_role, project_role, values):
    project = make_project(db)
    other = make_project(db)
    headers = actor(client, db, project, system_role, project_role)
    listed = client.get("/projects", headers=headers)
    assert listed.status_code == 200, listed.text
    by_id = {row["id"]: row for row in listed.json()}
    detail = client.get(f"/projects/{project.id}", headers=headers)
    if not values[0]:
        assert detail.status_code == 403
        assert detail.json() == {"detail": "Access denied"}
        assert str(project.id) not in by_id
        assert str(other.id) not in by_id
    else:
        assert detail.status_code == 200, detail.text
        assert detail.json()["id"] == str(project.id)
        assert_capabilities(detail.json(), project_role, values)
        assert_capabilities(by_id[str(project.id)], project_role, values)
        assert by_id[str(project.id)] == detail.json()
        if system_role == "Admin":
            assert_capabilities(by_id[str(other.id)], None, (True,) * 9)
        else:
            assert str(other.id) not in by_id


@pytest.mark.parametrize("system_role", ["Admin", "Project Manager"])
def test_project_create_exposes_creator_membership_and_capabilities(client, db, system_role):
    user = make_user(db, system_role)
    headers = login(client, user)[1]
    response = client.post("/projects", headers=headers, json={
        "name": "Fictional Wattle Renovation", "client": "Fictional Owner",
        "suburb": "Bendigo", "contract_value": "123456.78",
    })
    assert response.status_code == 200, response.text
    data = response.json()
    project_id = UUID(data["id"])
    db.info["project_ids"].append(project_id)
    assert_capabilities(data, "Manager", (True,) * 9)
    saved = db.get(Project, project_id)
    assert saved.name == "Fictional Wattle Renovation"
    assert saved.contract_value == Decimal("123456.78")
    member = db.query(ProjectMember).filter_by(project_id=project_id, user_id=user.id).one()
    assert member.project_role == "Manager"
    detail = client.get(f"/projects/{project_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json() == data


@pytest.mark.parametrize("system_role,project_role,values", ROLE_CASES)
def test_project_partial_patch_and_archive_preserve_authorization(client, db, system_role, project_role, values):
    project = make_project(db)
    headers = actor(client, db, project, system_role, project_role)
    old = {key: getattr(project, key) for key in (
        "client", "suburb", "status", "contract_value", "start_date", "end_date",
        "forecast_uncommitted_costs",
    )}
    response = client.patch(f"/projects/{project.id}", headers=headers,
                            json={"name": "Fictional Revised Name", "client": None})
    assert response.status_code == (200 if values[1] else 403), response.text
    db.refresh(project)
    assert project.name == ("Fictional Revised Name" if values[1] else "Fictional Banksia Extension")
    assert {key: getattr(project, key) for key in old} == old
    if values[1]:
        assert_capabilities(response.json(), project_role, values)
        assert response.json()["name"] == "Fictional Revised Name"
        assert response.json()["client"] == old["client"]
        assert response.json()["status"] == "On Hold"
        assert response.json()["contract_value"] == "250000.15"
        empty = client.patch(f"/projects/{project.id}", headers=headers, json={})
        assert empty.status_code == 200, empty.text
        assert_capabilities(empty.json(), project_role, values)
        db.refresh(project)
        assert {key: getattr(project, key) for key in old} == old
    archived = client.post(f"/projects/{project.id}/archive", headers=headers)
    assert archived.status_code == (200 if values[8] else 403), archived.text
    db.refresh(project)
    assert project.is_archived is values[8]
    if values[8]:
        assert_capabilities(archived.json(), project_role, values)
        assert archived.json()["is_archived"] is True
        assert project.archived_at is not None
        assert datetime.fromisoformat(archived.json()["archived_at"]) == project.archived_at


def make_subcontractor(db, project):
    sub = Subcontractor(
        id=uuid4(), project_id=project.id, trade="Carpentry", company="Fictional Timber Pty Ltd",
        scope="Frame", allowance=Decimal("4000.10"), committed=Decimal("3210.45"),
        paid=Decimal("1234.56"), status="complete",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@pytest.mark.parametrize("system_role,project_role,values", ROLE_CASES)
def test_subcontractor_partial_patch_preserves_values_and_authorization(client, db, system_role, project_role, values):
    project = make_project(db)
    sub = make_subcontractor(db, project)
    headers = actor(client, db, project, system_role, project_role)
    before = {key: getattr(sub, key) for key in (
        "trade", "scope", "allowance", "committed", "paid", "status",
    )}
    url = f"/projects/{project.id}/subcontractors/{sub.id}"
    response = client.patch(url, headers=headers,
                            json={"company": "Fictional Revised Timber", "scope": None})
    assert response.status_code == (200 if values[5] else 403), response.text
    db.refresh(sub)
    assert sub.company == ("Fictional Revised Timber" if values[5] else "Fictional Timber Pty Ltd")
    assert {key: getattr(sub, key) for key in before} == before
    if values[5]:
        data = response.json()
        assert data == {
            "id": str(sub.id), "project_id": str(project.id), "trade": "Carpentry",
            "company": "Fictional Revised Timber", "scope": "Frame", "allowance": "4000.10",
            "committed": "3210.45", "paid": "1234.56", "status": "complete",
        }
        empty = client.patch(url, headers=headers, json={})
        assert empty.status_code == 200, empty.text
        assert empty.json() == data
        readback = client.get(url, headers=headers)
        assert readback.status_code == 200
        assert readback.json() == data
        db.refresh(sub)
        assert {key: getattr(sub, key) for key in before} == before


def make_variation(db, project):
    now = datetime.now(timezone.utc)
    variation = Variation(
        id=uuid4(), project_id=project.id, description="Fictional extra framing",
        requested_by="Fictional Owner", cost_change=Decimal("100.10"), margin=Decimal("20.20"),
        total=Decimal("120.30"), status="Draft", created_at=now, updated_at=now,
    )
    db.add(variation)
    db.commit()
    db.refresh(variation)
    return variation


def assert_variation_money(data, saved, cost, margin, total):
    for field, expected in (("cost_change", cost), ("margin", margin), ("total", total)):
        assert data[field] == expected
        assert isinstance(getattr(saved, field), Decimal)
        assert getattr(saved, field) == Decimal(expected)


@pytest.mark.parametrize("legacy_fields", [{}, {"total": "999999.99"}, {"total": None}])
def test_variation_create_total_optional_and_server_authoritative(client, db, legacy_fields):
    project = make_project(db)
    headers = actor(client, db, project, "Admin", None)
    response = client.post(f"/projects/{project.id}/variations", headers=headers, json={
        "description": "Fictional framing change", "requested_by": "Fictional Owner",
        "cost_change": "100.10", "margin": "20.20", **legacy_fields,
    })
    assert response.status_code == 200, response.text
    data = response.json()
    saved = db.get(Variation, UUID(data["id"]))
    assert saved.project_id == project.id
    assert_variation_money(data, saved, "100.10", "20.20", "120.30")
    readback = client.get(f"/projects/{project.id}/variations/{saved.id}", headers=headers)
    assert readback.status_code == 200
    assert readback.json() == data


@pytest.mark.parametrize("changes,cost,margin,total", [
    ({"cost_change": "200.21"}, "200.21", "20.20", "220.41"),
    ({"margin": "30.31"}, "100.10", "30.31", "130.41"),
    ({"cost_change": "200.21", "margin": "30.31"}, "200.21", "30.31", "230.52"),
    ({"total": "999999.99"}, "100.10", "20.20", "120.30"),
    ({"cost_change": "200.21", "margin": "30.31", "total": "0.01"}, "200.21", "30.31", "230.52"),
    ({"cost_change": "0.00", "total": "999.99"}, "0.00", "20.20", "20.20"),
    ({"margin": "0.00", "total": "999.99"}, "100.10", "0.00", "100.10"),
    ({"cost_change": None, "margin": None, "total": None}, "100.10", "20.20", "120.30"),
])
def test_variation_patch_recomputes_total(client, db, changes, cost, margin, total):
    project = make_project(db)
    variation = make_variation(db, project)
    headers = actor(client, db, project, "Admin", None)
    url = f"/projects/{project.id}/variations/{variation.id}"
    response = client.patch(url, headers=headers, json=changes)
    assert response.status_code == 200, response.text
    db.refresh(variation)
    assert_variation_money(response.json(), variation, cost, margin, total)
    assert response.json()["description"] == "Fictional extra framing"
    assert response.json()["status"] == "Draft"
    readback = client.get(url, headers=headers)
    assert readback.status_code == 200
    assert readback.json() == response.json()


@pytest.mark.parametrize("system_role,project_role,values", ROLE_CASES)
def test_advertised_variation_and_subcontractor_writes_match_routes(client, db, system_role, project_role, values):
    project = make_project(db)
    variation = make_variation(db, project)
    headers = actor(client, db, project, system_role, project_role)
    created = client.post(f"/projects/{project.id}/variations", headers=headers, json={
        "description": "Fictional new variation", "requested_by": "Fictional Owner",
        "cost_change": "10.10", "margin": "0.20",
    })
    assert created.status_code == (200 if values[2] else 403), created.text
    assert db.query(Variation).filter_by(project_id=project.id).count() == (2 if values[2] else 1)
    updated = client.patch(f"/projects/{project.id}/variations/{variation.id}",
                           headers=headers, json={"cost_change": "200.21"})
    assert updated.status_code == (200 if values[3] else 403), updated.text
    db.refresh(variation)
    assert variation.cost_change == Decimal("200.21" if values[3] else "100.10")
    assert variation.total == Decimal("220.41" if values[3] else "120.30")
    subcontractor = client.post(f"/projects/{project.id}/subcontractors", headers=headers, json={
        "trade": "Plumbing", "company": "Fictional Pipes", "allowance": "1000.10",
        "scope": "Bathroom plumbing for fictional Ballarat renovation",
    })
    assert subcontractor.status_code == (200 if values[4] else 403), subcontractor.text
    assert db.query(Subcontractor).filter_by(project_id=project.id).count() == (1 if values[4] else 0)


def make_budget(db, project, category, budget, committed, actual):
    row = BudgetCategory(id=uuid4(), project_id=project.id, category=category,
                         budget=Decimal(budget), committed=Decimal(committed), actual=Decimal(actual))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def budget_json(row):
    return {"id": str(row.id), "category": row.category,
            "budget": str(row.budget), "committed": str(row.committed), "actual": str(row.actual)}


def test_budget_patch_decimal_readback_and_missing_category_no_creation(client, db):
    project = make_project(db)
    target = make_budget(db, project, "Framing", "1000.01", "500.02", "100.03")
    unrelated = make_budget(db, project, "Plumbing", "2000.11", "600.22", "200.33")
    other_project = make_project(db)
    other = make_budget(db, other_project, "Framing", "3000.44", "700.55", "300.66")
    untouched = {row.id: budget_json(row) for row in (unrelated, other)}
    headers = actor(client, db, project, "Viewer", "Manager")
    url = f"/projects/{project.id}/budget"
    response = client.patch(url, headers=headers, json={
        "category": "Framing", "budget": "9876543210.19", "committed": "1234567890.17", "actual": "0.29",
    })
    assert response.status_code == 200, response.text
    assert response.json() == {"message": "Budget updated"}
    db.refresh(target)
    for field, expected in (("budget", "9876543210.19"), ("committed", "1234567890.17"), ("actual", "0.29")):
        assert isinstance(getattr(target, field), Decimal)
        assert getattr(target, field) == Decimal(expected)
    for row in (unrelated, other):
        db.refresh(row)
        assert budget_json(row) == untouched[row.id]
    expected = {str(row.id): budget_json(row) for row in (target, unrelated)}
    readback = client.get(url, headers=headers)
    assert readback.status_code == 200, readback.text
    assert {row["id"]: row for row in readback.json()} == expected
    for row in readback.json():
        assert set(row) == {"id", "category", "budget", "committed", "actual"}
        assert str(UUID(row["id"])) == row["id"]
        assert isinstance(row["category"], str)
        assert all(isinstance(row[field], str) for field in ("budget", "committed", "actual"))
    missing = client.patch(url, headers=headers, json={"category": "Not seeded", "budget": "42.42"})
    assert missing.status_code == 200, missing.text
    assert missing.json() == {"message": "Budget updated"}
    db.expire_all()
    assert db.query(BudgetCategory).filter_by(project_id=project.id).count() == 2
    assert db.query(BudgetCategory).filter_by(project_id=project.id, category="Not seeded").count() == 0
    final = client.get(url, headers=headers)
    assert final.status_code == 200
    assert {row["id"]: row for row in final.json()} == expected
    for row in (target, unrelated, other):
        db.refresh(row)
        assert budget_json(row) == (expected[str(row.id)] if row.id in (target.id, unrelated.id) else untouched[row.id])


def response_cookies(response):
    cookies = []
    for header in response.headers.get_list("set-cookie"):
        parsed = SimpleCookie()
        parsed.load(header)
        cookies.extend(parsed.values())
    return cookies


def request_cookies(client, path):
    parsed = SimpleCookie()
    parsed.load(client.build_request("GET", path).headers.get("cookie", ""))
    return {name: morsel.value for name, morsel in parsed.items()}


@pytest.mark.parametrize("cookie_secure", [False, True])
def test_login_cookie_attributes_and_non_auth_path_delivery(client, db, cookie_secure):
    user = make_user(db)
    response, _ = login(client, user)
    cookies = {morsel.key: morsel for morsel in response_cookies(response)}
    assert set(cookies) == {"refresh_token", "csrf_token"}
    for name, path, http_only in (("refresh_token", "/auth", True), ("csrf_token", "/", False)):
        cookie = cookies[name]
        assert cookie.value
        assert cookie["path"] == path
        assert bool(cookie["httponly"]) is http_only
        assert cookie["samesite"].lower() == "strict"
        assert bool(cookie["secure"]) is cookie_secure
        assert int(cookie["max-age"]) > 0
    outside = request_cookies(client, "/projects")
    assert outside == {"csrf_token": cookies["csrf_token"].value}
    inside = request_cookies(client, "/auth/refresh")
    assert inside == {name: cookie.value for name, cookie in cookies.items()}
    http_cookies = request_cookies(client, "http://testserver/projects")
    assert http_cookies == ({} if cookie_secure else outside)


def test_refresh_csrf_enforcement_rotation_and_revocation(client, db):
    from app.auth.security import hash_token

    user = make_user(db)
    login(client, user)
    original = request_cookies(client, "/auth/refresh")
    csrf = original["csrf_token"]
    old_hash = hash_token(original["refresh_token"])
    missing = client.post("/auth/refresh")
    assert missing.status_code == 403
    assert missing.json() == {"detail": "CSRF validation failed"}
    wrong = client.post("/auth/refresh", headers={"X-CSRF-Token": "wrong-csrf"})
    assert wrong.status_code == 403
    assert wrong.json() == {"detail": "CSRF token mismatch"}
    # Supplying a header alone is not enough: both sides of double-submit are required.
    header_only = client.post("/auth/refresh", headers={
        "X-CSRF-Token": csrf, "Cookie": f"refresh_token={original['refresh_token']}",
    })
    assert header_only.status_code == 403
    assert header_only.json() == {"detail": "CSRF validation failed"}
    db.expire_all()
    assert db.query(RefreshSession).filter_by(user_id=user.id).count() == 1
    assert db.query(RefreshSession).filter_by(token_hash=old_hash).one().revoked is False
    refreshed = client.post("/auth/refresh", headers={"X-CSRF-Token": csrf})
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["token_type"] == "bearer"
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"})
    assert me.status_code == 200
    assert me.json()["id"] == str(user.id)
    new = request_cookies(client, "/auth/refresh")
    assert new["refresh_token"] != original["refresh_token"]
    db.expire_all()
    assert db.query(RefreshSession).filter_by(token_hash=old_hash).one().revoked is True
    assert db.query(RefreshSession).filter_by(token_hash=hash_token(new["refresh_token"])).one().revoked is False
    assert db.query(RefreshSession).filter_by(user_id=user.id).count() == 2
    replay = client.post("/auth/refresh", headers={
        "X-CSRF-Token": csrf,
        "Cookie": f"refresh_token={original['refresh_token']}; csrf_token={csrf}",
    })
    assert replay.status_code == 401
    assert replay.json() == {"detail": "Refresh session invalid or expired"}


def test_logout_requires_csrf_clears_root_and_legacy_cookies_and_revokes(client, db):
    from app.auth.security import hash_token

    user = make_user(db)
    login(client, user)
    original = request_cookies(client, "/auth/logout")
    csrf = original["csrf_token"]
    # A returning client may still have the historical /auth CSRF cookie.
    domain = next(cookie.domain for cookie in client.cookies.jar if cookie.name == "csrf_token")
    client.cookies.set("csrf_token", csrf, domain=domain, path="/auth")
    for headers in ({}, {"X-CSRF-Token": "wrong-csrf"}):
        denied = client.post("/auth/logout", headers=headers)
        assert denied.status_code == 403
        db.expire_all()
        assert db.query(RefreshSession).filter_by(token_hash=hash_token(original["refresh_token"])).one().revoked is False
    response = client.post("/auth/logout", headers={"X-CSRF-Token": csrf})
    assert response.status_code == 200, response.text
    assert response.json() == {"message": "Logged out"}
    deleted = {(cookie.key, cookie["path"]): cookie for cookie in response_cookies(response)}
    assert set(deleted) == {("refresh_token", "/auth"), ("csrf_token", "/"), ("csrf_token", "/auth")}
    for cookie in deleted.values():
        assert cookie["max-age"] == "0"
        assert cookie.value == ""
    assert not any(cookie.name in ("csrf_token", "refresh_token") for cookie in client.cookies.jar)
    assert request_cookies(client, "/projects") == {}
    assert request_cookies(client, "/auth/refresh") == {}
    db.expire_all()
    assert db.query(RefreshSession).filter_by(token_hash=hash_token(original["refresh_token"])).one().revoked is True
    replay = client.post("/auth/refresh", headers={
        "X-CSRF-Token": csrf,
        "Cookie": f"refresh_token={original['refresh_token']}; csrf_token={csrf}",
    })
    assert replay.status_code == 401
    assert replay.json() == {"detail": "Refresh session invalid or expired"}
