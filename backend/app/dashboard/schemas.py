from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class KPIResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: UUID
    project_name: str
    contract_value: Decimal
    approved_variations_total: Decimal
    revised_contract_value: Decimal
    budget_total: Decimal
    budget_committed: Decimal
    budget_actual: Decimal
    budget_remaining: Decimal
    subcontractor_allowance: Decimal
    subcontractor_committed: Decimal
    subcontractor_paid: Decimal
    subcontractor_outstanding: Decimal
    claims_total: Decimal
    claims_draft: Decimal
    claims_issued: Decimal
    claims_paid: Decimal
    claims_overdue: Decimal
    claims_outstanding: Decimal
    variation_counts: dict[
        Literal["Draft", "Submitted", "Pending", "Approved", "Rejected"], int
    ]
    claim_counts: dict[Literal["Draft", "Issued", "Paid", "Overdue"], int]
