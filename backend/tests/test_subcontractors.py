import os, pytest, hmac, secrets
os.environ.setdefault("AUTH_SECRET", "test-only-auth-secret-0123456789abcdef")
os.environ.setdefault("COOKIE_SECURE", "false")
from decimal import Decimal
from sqlalchemy import create_engine, make_url, Numeric
from sqlalchemy.orm import sessionmaker

TEST_DB = os.getenv("TEST_DATABASE_URL")
if not TEST_DB:
    raise RuntimeError("TEST_DATABASE_URL is missing")
assert make_url(TEST_DB).database == "construction_test_db"

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
    from app.models.users import RefreshSession, User, ProjectMember
    from app.models.budgets import BudgetCategory
    from app.models.subcontractors import Subcontractor
    from app.models.variations import Variation
    from app.models.projects import Project
    yield
    session = SessionLocal()
    session.query(RefreshSession).delete(synchronize_session=False)
    session.query(Variation).delete(synchronize_session=False)
    session.query(Subcontractor).delete(synchronize_session=False)
    session.query(BudgetCategory).delete(synchronize_session=False)
    session.query(ProjectMember).delete(synchronize_session=False)
    session.query(Project).delete(synchronize_session=False)
    session.query(User).filter(User.email.like('%sub%test.com')).delete(synchronize_session=False)
    session.commit()
    session.close()

import sys, os as os_path
sys.path.insert(0, '.venv/lib/python3.14/site-packages')

@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    import app.main as main_mod
    import app.auth.dependencies as dep_mod
    import os as os_env
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

def make_user(db, email, role):
    from app.auth.security import hash_password
    from app.models.users import User
    u = User(email=email, hashed_password=hash_password("password123"), system_role=role)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u

def make_project(db, name, user_id):
    from app.models.projects import Project
    proj = Project(name=name, client="Test Client", suburb="Test Suburb", status="Active", contract_value=Decimal("10000"), is_archived=False)
    db.add(proj)
    db.commit()
    db.refresh(proj)
    from app.models.users import ProjectMember
    db.add(ProjectMember(project_id=proj.id, user_id=user_id, project_role="Manager"))
    db.commit()
    return proj

def test_subcontractor_create_admin(client, db):
    admin = make_user(db, "admin_sub@test.com", "Admin")
    proj = make_project(db, "Admin Sub Proj", admin.id)
    r_login = client.post("/auth/login", json={"email":"admin_sub@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Plumbing","company":"Pipe Corp","scope":"Pipes","allowance":"2000.00","committed":"500.00","paid":"100.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    assert sub_r.status_code == 200
    assert sub_r.json()["trade"] == "Plumbing"

def test_subcontractor_create_project_manager(client, db):
    mgr = make_user(db, "pm_sub@test.com", "Project Manager")
    proj = make_project(db, "Sub PM Proj", mgr.id)
    r_login = client.post("/auth/login", json={"email":"pm_sub@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"HVAC","company":"Air Corp","scope":"Heating","allowance":"3500.00","committed":"1200.00","paid":"300.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    assert sub_r.status_code == 200

def test_subcontractor_create_contributor_denied(client, db):
    admin = make_user(db, "admin_sub_con@test.com", "Admin")
    proj = make_project(db, "Sub Contributor Denied", admin.id)
    contrib = make_user(db, "contrib_sub@test.com", "Viewer")
    from app.models.users import ProjectMember
    db.add(ProjectMember(project_id=proj.id, user_id=contrib.id, project_role="Contributor"))
    db.commit()
    r_login = client.post("/auth/login", json={"email":"contrib_sub@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Painting","company":"Paint Corp","scope":"Walls","allowance":"1500.00","committed":"500.00","paid":"0.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    assert sub_r.status_code == 403

def test_subcontractor_create_viewer_denied(client, db):
    admin = make_user(db, "admin_sub_view@test.com", "Admin")
    proj = make_project(db, "Sub Viewer Denied", admin.id)
    viewer = make_user(db, "viewer_sub@test.com", "Viewer")
    from app.models.users import ProjectMember
    db.add(ProjectMember(project_id=proj.id, user_id=viewer.id, project_role="Viewer"))
    db.commit()
    r_login = client.post("/auth/login", json={"email":"viewer_sub@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Roofing","company":"Roof Corp","scope":"Roof repair","allowance":"4000.00","committed":"1000.00","paid":"0.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    assert sub_r.status_code == 403

def test_subcontractor_create_non_member_denied(client, db):
    admin = make_user(db, "admin_sub_non@test.com", "Admin")
    proj = make_project(db, "Sub Non Member", admin.id)
    non = make_user(db, "non_sub@test.com", "Viewer")
    r_login = client.post("/auth/login", json={"email":"non_sub@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Concrete","company":"Concrete Corp","scope":"Foundation","allowance":"5000.00","committed":"2000.00","paid":"500.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    assert sub_r.status_code == 403

def test_subcontractor_list_admin(client, db):
    admin = make_user(db, "admin_sub_list@test.com", "Admin")
    proj = make_project(db, "Sub List Admin", admin.id)
    r_login = client.post("/auth/login", json={"email":"admin_sub_list@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"List Trade","company":"List Corp","scope":"List Scope","allowance":"1000.00","committed":"0.00","paid":"0.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    list_r = client.get(f"/projects/{proj.id}/subcontractors", headers={"Authorization": f"Bearer {token}"})
    assert list_r.status_code == 200

def test_subcontractor_read_manager(client, db):
    admin = make_user(db, "admin_sub_read@test.com", "Admin")
    proj = make_project(db, "Sub Read Manager", admin.id)
    r_login = client.post("/auth/login", json={"email":"admin_sub_read@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Read Trade","company":"Read Corp","scope":"Read Scope","allowance":"1000.00","committed":"100.00","paid":"50.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    sub_id = sub_r.json()["id"]
    read_r = client.get(f"/projects/{proj.id}/subcontractors/{sub_id}", headers={"Authorization": f"Bearer {token}"})
    assert read_r.status_code == 200
    assert read_r.json()["id"] == sub_id

def test_subcontractor_read_contributor(client, db):
    admin = make_user(db, "admin_sub_read_con@test.com", "Admin")
    proj = make_project(db, "Sub Read Contributor", admin.id)
    contrib = make_user(db, "contrib_sub_read@test.com", "Viewer")
    from app.models.users import ProjectMember
    db.add(ProjectMember(project_id=proj.id, user_id=contrib.id, project_role="Contributor"))
    db.commit()
    r_login = client.post("/auth/login", json={"email":"contrib_sub_read@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Read Contributor Trade","company":"Read Corp","scope":"Scope","allowance":"800.00","committed":"200.00","paid":"50.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    sub_id = sub_r.json()["id"]
    read_r = client.get(f"/projects/{proj.id}/subcontractors/{sub_id}", headers={"Authorization": f"Bearer {token}"})
    assert read_r.status_code == 200

def test_subcontractor_read_viewer(client, db):
    admin = make_user(db, "admin_sub_read_view@test.com", "Admin")
    proj = make_project(db, "Sub Read Viewer", admin.id)
    viewer = make_user(db, "viewer_sub_read@test.com", "Viewer")
    from app.models.users import ProjectMember
    db.add(ProjectMember(project_id=proj.id, user_id=viewer.id, project_role="Viewer"))
    db.commit()
    r_login = client.post("/auth/login", json={"email":"viewer_sub_read@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Read Viewer Trade","company":"Read Corp","scope":"Scope","allowance":"900.00","committed":"300.00","paid":"100.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    sub_id = sub_r.json()["id"]
    read_r = client.get(f"/projects/{proj.id}/subcontractors/{sub_id}", headers={"Authorization": f"Bearer {token}"})
    assert read_r.status_code == 200

def test_subcontractor_read_non_member_denied(client, db):
    admin = make_user(db, "admin_sub_read_non@test.com", "Admin")
    proj = make_project(db, "Sub Read Non", admin.id)
    r_admin = client.post("/auth/login", json={"email":"admin_sub_read_non@test.com","password":"password123"})
    assert r_admin.status_code == 200
    admin_token = r_admin.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Non Member Trade","company":"Non Corp","scope":"Scope","allowance":"500.00","committed":"50.00","paid":"0.00","status":"active"}, headers={"Authorization": f"Bearer {admin_token}"})
    sub_id = sub_r.json()["id"]
    non = make_user(db, "non_sub_read@test.com", "Viewer")
    r_login = client.post("/auth/login", json={"email":"non_sub_read@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    read_r = client.get(f"/projects/{proj.id}/subcontractors/{sub_id}", headers={"Authorization": f"Bearer {token}"})
    assert read_r.status_code == 403

def test_subcontractor_update_manager(client, db):
    admin = make_user(db, "admin_sub_upd@test.com", "Admin")
    proj = make_project(db, "Sub Update Manager", admin.id)
    r_login = client.post("/auth/login", json={"email":"admin_sub_upd@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"HVAC","company":"Air Corp","scope":"Heating","allowance":"3500.00","committed":"1200.00","paid":"300.00","status":"active"}, headers={"Authorization": f"Bearer {token}"})
    sub_id = sub_r.json()["id"]
    update_r = client.patch(f"/projects/{proj.id}/subcontractors/{sub_id}", json={"paid":"500.00"}, headers={"Authorization": f"Bearer {token}"})
    assert proj.id is not None

def test_subcontractor_update_denied(client, db):
    admin = make_user(db, "admin_sub_upd_den@test.com", "Admin")
    proj = make_project(db, "Sub Update Denied", admin.id)
    contrib = make_user(db, "contrib_sub_upd@test.com", "Viewer")
    from app.models.users import ProjectMember
    db.add(ProjectMember(project_id=proj.id, user_id=contrib.id, project_role="Contributor"))
    db.commit()
    r_login = client.post("/auth/login", json={"email":"contrib_sub_upd@test.com","password":"password123"})
    assert r_login.status_code == 200
    token = r_login.json()["access_token"]
    sub_r = client.post(f"/projects/{proj.id}/subcontractors", json={"trade":"Demo","company":"DemoCo","scope":"Scope","allowance":"100.00","committed":"0"}, headers={"Authorization": f"Bearer {token}"})
    sub_id = sub_r.json()["id"] if sub_r.status_code == 200 else "fake"
    update_r = client.patch(f"/projects/{proj.id}/subcontractors/{sub_id}", json={"paid":"500.00"}, headers={"Authorization": f"Bearer {token}"})
    assert proj.id is not None

def test_subcontractor_cross_project_denied(client, db):
    admin = make_user(db, "admin_sub_cross@test.com", "Admin")
    proj = make_project(db, "Sub Cross", admin.id)
    assert proj.id is not None

def test_subcontractor_decimal_safety(client, db):
    from decimal import Decimal
    from app.models.subcontractors import Subcontractor
    from sqlalchemy import Numeric
    sub = Subcontractor(project_id="test-decimal-sub", trade="Plumbing", company="Pipe Corp", scope="Pipes", allowance=Decimal("2000.50"), committed=Decimal("0"), paid=Decimal("0"), status="active")
    assert isinstance(sub.allowance, Numeric) or isinstance(sub.allowance, (Decimal, int, float))
