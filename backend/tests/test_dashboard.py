"""PostgreSQL integration coverage for authenticated, project-scoped dashboard KPIs."""

import os
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

# Deliberately test-only values, set before any application/security imports.
os.environ["AUTH_SECRET"] = "test-only-auth-secret-0123456789abcdef"
os.environ["COOKIE_SECURE"] = "false"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, make_url, select
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.budgets import BudgetCategory
from app.models.claims import ProgressClaim
from app.models.projects import Project
from app.models.subcontractors import Subcontractor
from app.models.users import ProjectMember, RefreshSession, User
from app.models.variations import Variation


@pytest.fixture
def test_database_url():
    url = os.environ.get("TEST_DATABASE_URL")
    assert url, "TEST_DATABASE_URL is mandatory; DATABASE_URL is never a fallback"
    parsed = make_url(url)
    assert parsed.database == "construction_test_db", "Unsafe test database name"
    assert parsed.get_backend_name() == "postgresql", "PostgreSQL is required"
    return url


@pytest.fixture
def test_engine(test_database_url):
    engine = create_engine(test_database_url)
    try:
        Base.metadata.create_all(engine)
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def db(test_engine):
    session = sessionmaker(bind=test_engine, expire_on_commit=False)()
    session.info["project_ids"] = set()
    session.info["user_ids"] = set()
    try:
        yield session
    finally:
        try:
            session.rollback()
            project_ids = tuple(session.info["project_ids"])
            user_ids = tuple(session.info["user_ids"])
            # Delete only records belonging to projects/users created by this test.
            for model in (
                ProgressClaim,
                Variation,
                Subcontractor,
                BudgetCategory,
                ProjectMember,
            ):
                session.execute(
                    delete(model).where(model.project_id.in_(project_ids)),
                    execution_options={"synchronize_session": False},
                )
            session.execute(
                delete(Project).where(Project.id.in_(project_ids)),
                execution_options={"synchronize_session": False},
            )
            session.execute(
                delete(RefreshSession).where(RefreshSession.user_id.in_(user_ids)),
                execution_options={"synchronize_session": False},
            )
            session.execute(
                delete(User).where(User.id.in_(user_ids)),
                execution_options={"synchronize_session": False},
            )
            session.commit()
        finally:
            session.close()


@pytest.fixture
def client(db, test_engine, test_database_url, monkeypatch):
    # dependencies creates its engine at import, so configure it BEFORE importing.
    monkeypatch.setenv("DATABASE_URL", test_database_url)
    monkeypatch.setenv("AUTH_SECRET", "test-only-auth-secret-0123456789abcdef")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    import app.auth.dependencies as dep
    from app.main import app

    request_sessions = sessionmaker(bind=test_engine)

    def override_get_db():
        request_db = request_sessions()
        try:
            yield request_db
        finally:
            request_db.close()

    absent = object()
    previous = app.dependency_overrides.get(dep.get_db, absent)
    app.dependency_overrides[dep.get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        if previous is absent:
            app.dependency_overrides.pop(dep.get_db, None)
        else:
            app.dependency_overrides[dep.get_db] = previous


def _user(db, system_role):
    from app.auth.security import hash_password

    user_id = uuid4()
    db.info["user_ids"].add(user_id)
    user = User(
        id=user_id,
        email=f"dashboard-{user_id.hex}@example.com",
        hashed_password=hash_password("password123"),
        system_role=system_role,
    )
    db.add(user)
    db.commit()
    return user


def _project(db, contract_value="10000.00", name="Fictional Wattle House, Ballarat"):
    project_id = uuid4()
    db.info["project_ids"].add(project_id)
    now = datetime.now(timezone.utc)
    project = Project(
        id=project_id,
        name=name,
        client="Fictional Wattle Housing Pty Ltd",
        suburb="Ballarat",
        status="Active",
        contract_value=Decimal(contract_value),
        is_archived=False,
        created_at=now,
        updated_at=now,
    )
    db.add(project)
    db.commit()
    return project


def _membership(db, project, user, role):
    db.add(
        ProjectMember(
            id=uuid4(), project_id=project.id, user_id=user.id, project_role=role
        )
    )
    db.commit()


def _login(client, user):
    response = client.post(
        "/auth/login", json={"email": user.email, "password": "password123"}
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["token_type"] == "bearer"
    token = payload["access_token"]
    assert isinstance(token, str)
    assert token
    return {"Authorization": f"Bearer {token}"}


def _dashboard(client, project, headers):
    response = client.get(f"/projects/{project.id}/dashboard", headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["project_id"] == str(project.id)
    assert data["project_name"] == project.name
    return data


def _assert_money(data, expected):
    for field, amount in expected.items():
        assert isinstance(data[field], str), f"{field} must serialize as a decimal string"
        assert Decimal(data[field]) == Decimal(amount), field


def _variation(db, project, status, total, margin="0.00"):
    now = datetime.now(timezone.utc)
    db.add(
        Variation(
            id=uuid4(),
            project_id=project.id,
            description="Fictional additional verandah works",
            requested_by="Fictional Wattle Housing representative",
            cost_change=Decimal(total) - Decimal(margin),
            margin=Decimal(margin),
            total=Decimal(total),
            status=status,
            approval_date=now if status == "Approved" else None,
            created_at=now,
            updated_at=now,
        )
    )


def _budget(db, project, category, budget, committed, actual):
    db.add(
        BudgetCategory(
            id=uuid4(),
            project_id=project.id,
            category=category,
            budget=Decimal(budget),
            committed=Decimal(committed),
            actual=Decimal(actual),
        )
    )


def _subcontractor(db, project, trade, allowance, committed, paid):
    db.add(
        Subcontractor(
            id=uuid4(),
            project_id=project.id,
            trade=trade,
            company=f"Fictional Wattle {trade} Pty Ltd",
            scope="Fictional residential construction works",
            allowance=Decimal(allowance),
            committed=Decimal(committed),
            paid=Decimal(paid),
            status="active",
        )
    )


def _claim(db, project, status, amount):
    now = datetime.now(timezone.utc)
    db.add(
        ProgressClaim(
            id=uuid4(),
            project_id=project.id,
            claim_no=f"PC-{uuid4().hex}",
            stage="Frame",
            date=now,
            amount=Decimal(amount),
            status=status,
            paid_date=now if status == "Paid" else None,
        )
    )


@pytest.fixture
def admin_headers(client, db):
    return _login(client, _user(db, "Admin"))


@pytest.fixture
def unrelated_finances(db):
    """Real rows in every aggregate table must never affect the target project."""
    project = _project(
        db, "987654.32", name="Fictional Banksia Cottage, Bendigo"
    )
    for status in ("Draft", "Submitted", "Pending", "Approved", "Rejected"):
        _variation(db, project, status, "87654.32", margin="100.00")
    for status in ("Draft", "Issued", "Paid", "Overdue"):
        _claim(db, project, status, "76543.21")
    _budget(db, project, "Earthworks", "90000.00", "80000.00", "70000.00")
    _budget(db, project, "Joinery", "60000.00", "50000.00", "40000.00")
    _subcontractor(db, project, "Plumbing", "30000.00", "20000.00", "10000.00")
    _subcontractor(db, project, "Electrical", "60000.00", "50000.00", "40000.00")
    db.commit()
    return project


def test_dashboard_admin_access_without_membership(client, db):
    project = _project(db)
    admin = _user(db, "Admin")
    membership = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == admin.id
        )
    )
    assert membership is None
    data = _dashboard(client, project, _login(client, admin))
    _assert_money(data, {"contract_value": "10000.00", "revised_contract_value": "10000.00"})


def test_dashboard_manager_membership_grants_system_viewer_access(client, db):
    project = _project(db)
    manager = _user(db, "Viewer")
    _membership(db, project, manager, "Manager")
    data = _dashboard(client, project, _login(client, manager))
    _assert_money(data, {"contract_value": "10000.00", "approved_variations_total": "0.00"})


def test_dashboard_contributor_member_access(client, db):
    project = _project(db)
    contributor = _user(db, "Viewer")
    _membership(db, project, contributor, "Contributor")
    data = _dashboard(client, project, _login(client, contributor))
    _assert_money(data, {"contract_value": "10000.00", "budget_total": "0.00"})


def test_dashboard_viewer_member_access(client, db):
    project = _project(db)
    viewer = _user(db, "Viewer")
    _membership(db, project, viewer, "Viewer")
    data = _dashboard(client, project, _login(client, viewer))
    _assert_money(data, {"contract_value": "10000.00", "claims_total": "0.00"})


def test_dashboard_non_member_project_manager_is_forbidden(client, db):
    project = _project(db)
    unrelated = _project(db, name="Fictional Banksia Manager Project, Bendigo")
    manager = _user(db, "Project Manager")
    _membership(db, unrelated, manager, "Manager")
    assert db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == manager.id
        )
    ) is None
    headers = _login(client, manager)
    _dashboard(client, unrelated, headers)
    response = client.get(f"/projects/{project.id}/dashboard", headers=headers)
    assert response.status_code == 403, response.text
    assert response.json() == {"detail": "Access denied"}


def test_dashboard_missing_project_returns_not_found(client, db, admin_headers):
    missing_id = uuid4()
    assert db.get(Project, missing_id) is None
    response = client.get(f"/projects/{missing_id}/dashboard", headers=admin_headers)
    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Project not found"}


def test_dashboard_empty_zero_contract_has_all_money_kpis_zero(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db, "0.00")
    data = _dashboard(client, project, admin_headers)
    expected = {
        "contract_value": "0.00",
        "approved_variations_total": "0.00",
        "revised_contract_value": "0.00",
        "budget_total": "0.00",
        "budget_committed": "0.00",
        "budget_actual": "0.00",
        "budget_remaining": "0.00",
        "subcontractor_allowance": "0.00",
        "subcontractor_committed": "0.00",
        "subcontractor_paid": "0.00",
        "subcontractor_outstanding": "0.00",
        "claims_total": "0.00",
        "claims_draft": "0.00",
        "claims_issued": "0.00",
        "claims_paid": "0.00",
        "claims_overdue": "0.00",
        "claims_outstanding": "0.00",
    }
    assert set(data) == set(expected) | {
        "project_id", "project_name", "variation_counts", "claim_counts"
    }
    _assert_money(data, expected)
    assert data["variation_counts"] == {
        "Draft": 0, "Submitted": 0, "Pending": 0, "Approved": 0, "Rejected": 0
    }
    assert data["claim_counts"] == {"Draft": 0, "Issued": 0, "Paid": 0, "Overdue": 0}


def test_dashboard_approved_variations_change_approved_and_revised_totals(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    before = _dashboard(client, project, admin_headers)
    _assert_money(before, {"approved_variations_total": "0.00", "revised_contract_value": "10000.00"})
    _variation(db, project, "Approved", "120.10", margin="20.00")
    _variation(db, project, "Approved", "30.20", margin="5.00")
    db.commit()
    data = _dashboard(client, project, admin_headers)
    approved = Decimal("120.10") + Decimal("30.20")
    _assert_money(data, {
        "contract_value": "10000.00",
        "approved_variations_total": approved,
        "revised_contract_value": Decimal("10000.00") + approved,
    })
    assert data["variation_counts"]["Approved"] == 2


def test_dashboard_other_four_variation_statuses_do_not_revise_contract(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    for status in ("Draft", "Submitted", "Pending", "Rejected"):
        _variation(db, project, status, "1234.56", margin="34.56")
    db.commit()
    data = _dashboard(client, project, admin_headers)
    _assert_money(data, {
        "contract_value": "10000.00",
        "approved_variations_total": "0.00",
        "revised_contract_value": "10000.00",
    })
    assert data["variation_counts"] == {
        "Draft": 1, "Submitted": 1, "Pending": 1, "Approved": 0, "Rejected": 1
    }


def test_dashboard_budget_totals_are_exact_and_separate_from_subcontractors(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    _budget(db, project, "Earthworks", "1200.10", "800.20", "300.30")
    _budget(db, project, "Framing", "2300.40", "900.50", "400.60")
    _subcontractor(db, project, "Plumbing", "5000.00", "4000.00", "3000.00")
    _subcontractor(db, project, "Electrical", "6000.00", "5000.00", "2000.00")
    db.commit()
    data = _dashboard(client, project, admin_headers)
    budget = Decimal("1200.10") + Decimal("2300.40")
    actual = Decimal("300.30") + Decimal("400.60")
    _assert_money(data, {
        "budget_total": budget,
        "budget_committed": Decimal("800.20") + Decimal("900.50"),
        "budget_actual": actual,
        "budget_remaining": budget - actual,
        "subcontractor_allowance": Decimal("5000.00") + Decimal("6000.00"),
    })


def test_dashboard_subcontractor_totals_are_exact_and_separate_from_budgets(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    _subcontractor(db, project, "Plumbing", "1500.10", "1100.20", "300.30")
    _subcontractor(db, project, "Electrical", "2600.40", "1700.50", "500.60")
    _budget(db, project, "Earthworks", "7000.00", "6000.00", "5000.00")
    _budget(db, project, "Framing", "8000.00", "7000.00", "4000.00")
    db.commit()
    data = _dashboard(client, project, admin_headers)
    committed = Decimal("1100.20") + Decimal("1700.50")
    paid = Decimal("300.30") + Decimal("500.60")
    _assert_money(data, {
        "subcontractor_allowance": Decimal("1500.10") + Decimal("2600.40"),
        "subcontractor_committed": committed,
        "subcontractor_paid": paid,
        "subcontractor_outstanding": committed - paid,
        "budget_total": Decimal("7000.00") + Decimal("8000.00"),
    })


def test_dashboard_claim_status_amount_totals_are_exact(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    amounts = {
        "Draft": ("10.10", "0.20"),
        "Issued": ("100.10", "0.20"),
        "Paid": ("200.10", "0.20"),
        "Overdue": ("300.10", "0.20"),
    }
    for status, values in amounts.items():
        for value in values:
            _claim(db, project, status, value)
    db.commit()
    data = _dashboard(client, project, admin_headers)
    _assert_money(data, {
        "claims_draft": Decimal("10.10") + Decimal("0.20"),
        "claims_issued": Decimal("100.10") + Decimal("0.20"),
        "claims_paid": Decimal("200.10") + Decimal("0.20"),
        "claims_overdue": Decimal("300.10") + Decimal("0.20"),
    })


def test_dashboard_claims_total_excludes_draft(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    _claim(db, project, "Issued", "100.10")
    _claim(db, project, "Paid", "200.20")
    _claim(db, project, "Overdue", "300.30")
    db.commit()
    expected_total = Decimal("100.10") + Decimal("200.20") + Decimal("300.30")
    before = _dashboard(client, project, admin_headers)
    _assert_money(before, {"claims_total": expected_total, "claims_draft": "0.00"})
    _claim(db, project, "Draft", "9999.99")
    db.commit()
    after = _dashboard(client, project, admin_headers)
    _assert_money(after, {"claims_total": expected_total, "claims_draft": "9999.99"})
    assert after["claim_counts"]["Draft"] == 1


def test_dashboard_claims_outstanding_is_issued_plus_overdue_only(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    _claim(db, project, "Issued", "100.10")
    _claim(db, project, "Issued", "20.20")
    _claim(db, project, "Overdue", "300.30")
    _claim(db, project, "Overdue", "40.40")
    _claim(db, project, "Paid", "5000.50")
    _claim(db, project, "Draft", "6000.60")
    db.commit()
    data = _dashboard(client, project, admin_headers)
    issued = Decimal("100.10") + Decimal("20.20")
    overdue = Decimal("300.30") + Decimal("40.40")
    _assert_money(data, {
        "claims_issued": issued,
        "claims_overdue": overdue,
        "claims_outstanding": issued + overdue,
        "claims_paid": "5000.50",
        "claims_draft": "6000.60",
    })


def test_dashboard_all_five_variation_counts_are_exact(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    expected = {"Draft": 1, "Submitted": 2, "Pending": 3, "Approved": 4, "Rejected": 5}
    for status, count in expected.items():
        for _ in range(count):
            _variation(db, project, status, "10.00")
    db.commit()
    data = _dashboard(client, project, admin_headers)
    assert data["variation_counts"] == expected
    assert all(type(count) is int for count in data["variation_counts"].values())
    assert data["claim_counts"] == {"Draft": 0, "Issued": 0, "Paid": 0, "Overdue": 0}


def test_dashboard_all_four_claim_counts_are_exact(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db)
    expected = {"Draft": 1, "Issued": 2, "Paid": 3, "Overdue": 4}
    for status, count in expected.items():
        for _ in range(count):
            _claim(db, project, status, "10.00")
    db.commit()
    data = _dashboard(client, project, admin_headers)
    assert data["claim_counts"] == expected
    assert all(type(count) is int for count in data["claim_counts"].values())
    assert data["variation_counts"] == {
        "Draft": 0, "Submitted": 0, "Pending": 0, "Approved": 0, "Rejected": 0
    }


def test_dashboard_decimal_precision_preserves_100_10_plus_0_20(
    client, db, admin_headers, unrelated_finances
):
    project = _project(db, "100.10")
    _variation(db, project, "Approved", "0.20")
    _budget(db, project, "Earthworks", "100.10", "100.10", "100.10")
    _budget(db, project, "Framing", "0.20", "0.20", "0.20")
    _subcontractor(db, project, "Plumbing", "100.10", "100.10", "100.10")
    _subcontractor(db, project, "Electrical", "0.20", "0.20", "0.20")
    _claim(db, project, "Issued", "100.10")
    _claim(db, project, "Overdue", "0.20")
    db.commit()
    data = _dashboard(client, project, admin_headers)
    _assert_money(data, {
        "contract_value": "100.10",
        "approved_variations_total": "0.20",
        "revised_contract_value": "100.30",
        "budget_total": "100.30",
        "budget_committed": "100.30",
        "budget_actual": "100.30",
        "budget_remaining": "0.00",
        "subcontractor_allowance": "100.30",
        "subcontractor_committed": "100.30",
        "subcontractor_paid": "100.30",
        "subcontractor_outstanding": "0.00",
        "claims_total": "100.30",
        "claims_issued": "100.10",
        "claims_overdue": "0.20",
        "claims_outstanding": "100.30",
    })
    assert data["revised_contract_value"] == "100.30"
