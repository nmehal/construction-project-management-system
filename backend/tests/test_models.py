import pytest
import os
from sqlalchemy import create_engine, Numeric, DateTime, Boolean, String
from sqlalchemy.orm import sessionmaker
from app.models.base import Base
from app.models.users import User, ProjectMember, RefreshSession
from app.models.projects import Project
from app.models.variations import Variation
from app.models.subcontractors import Subcontractor
from app.models.claims import ProgressClaim
from app.models.budgets import BudgetCategory

test_db_url = os.environ.get("TEST_DATABASE_URL")
if not test_db_url:
    raise RuntimeError("TEST_DATABASE_URL is missing. Set it to postgresql://postgres:<pw>@postgres:5432/construction_test_db")

engine = create_engine(test_db_url)
Session = sessionmaker(bind=engine)

@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)

def test_users_table_has_numeric_not_float():
    col_type = Project.__table__.columns['contract_value'].type
    assert isinstance(col_type, Numeric)
    assert col_type.precision == 14
    assert col_type.scale == 2

def test_project_members_unique_constraint():
    assert "uq_project_user" in [c.name for c in ProjectMember.__table__.constraints if hasattr(c, 'name')]

def test_project_has_forecast_uncommitted():
    assert "forecast_uncommitted_costs" in Project.__table__.columns

def test_budget_variance_not_stored():
    assert "variance" not in BudgetCategory.__table__.columns
