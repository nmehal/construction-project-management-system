from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, get_db
from app.dashboard.schemas import KPIResponse
from app.models.budgets import BudgetCategory
from app.models.claims import ProgressClaim
from app.models.projects import Project
from app.models.subcontractors import Subcontractor
from app.models.users import User
from app.models.variations import Variation
from app.projects.permissions import user_can_read_project


router = APIRouter(prefix="/projects", tags=["dashboard"])
ZERO = Decimal("0")
VARIATION_STATUSES = ("Draft", "Submitted", "Pending", "Approved", "Rejected")
CLAIM_STATUSES = ("Draft", "Issued", "Paid", "Overdue")


@router.get("/{project_id}/dashboard", response_model=KPIResponse)
def get_project_dashboard(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")

    # Aggregate each child table separately: joins would multiply totals.
    variation_counts = {status: 0 for status in VARIATION_STATUSES}
    approved_variations_total = ZERO
    variation_rows = db.execute(
        select(Variation.status, func.count(Variation.id), func.sum(Variation.total))
        .where(Variation.project_id == project_id)
        .group_by(Variation.status)
    ).all()
    for status, count, total in variation_rows:
        if status in variation_counts:
            variation_counts[status] = count
        if status == "Approved":
            approved_variations_total = total if total is not None else ZERO

    budget_row = db.execute(
        select(
            func.sum(BudgetCategory.budget),
            func.sum(BudgetCategory.committed),
            func.sum(BudgetCategory.actual),
        ).where(BudgetCategory.project_id == project_id)
    ).one()
    budget_total, budget_committed, budget_actual = (
        value if value is not None else ZERO for value in budget_row
    )

    subcontractor_row = db.execute(
        select(
            func.sum(Subcontractor.allowance),
            func.sum(Subcontractor.committed),
            func.sum(Subcontractor.paid),
        ).where(Subcontractor.project_id == project_id)
    ).one()
    subcontractor_allowance, subcontractor_committed, subcontractor_paid = (
        value if value is not None else ZERO for value in subcontractor_row
    )

    claim_counts = {status: 0 for status in CLAIM_STATUSES}
    claim_totals = {status: ZERO for status in CLAIM_STATUSES}
    claim_rows = db.execute(
        select(
            ProgressClaim.status,
            func.count(ProgressClaim.id),
            func.sum(ProgressClaim.amount),
        )
        .where(ProgressClaim.project_id == project_id)
        .group_by(ProgressClaim.status)
    ).all()
    for status, count, total in claim_rows:
        if status in claim_counts:
            claim_counts[status] = count
            claim_totals[status] = total if total is not None else ZERO

    # PostgreSQL NUMERIC sums and contract_value are Decimal, never float.
    return KPIResponse(
        project_id=project.id,
        project_name=project.name,
        contract_value=project.contract_value,
        approved_variations_total=approved_variations_total,
        revised_contract_value=project.contract_value + approved_variations_total,
        budget_total=budget_total,
        budget_committed=budget_committed,
        budget_actual=budget_actual,
        budget_remaining=budget_total - budget_actual,
        subcontractor_allowance=subcontractor_allowance,
        subcontractor_committed=subcontractor_committed,
        subcontractor_paid=subcontractor_paid,
        subcontractor_outstanding=subcontractor_committed - subcontractor_paid,
        claims_total=(
            claim_totals["Issued"] + claim_totals["Paid"] + claim_totals["Overdue"]
        ),
        claims_draft=claim_totals["Draft"],
        claims_issued=claim_totals["Issued"],
        claims_paid=claim_totals["Paid"],
        claims_overdue=claim_totals["Overdue"],
        claims_outstanding=claim_totals["Issued"] + claim_totals["Overdue"],
        variation_counts=variation_counts,
        claim_counts=claim_counts,
    )
