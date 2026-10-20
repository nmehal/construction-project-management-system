from uuid import UUID
from decimal import Decimal
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    client: str = Field(min_length=1, max_length=255)
    suburb: str = Field(min_length=1, max_length=128)
    status: str = Field(default="Active", max_length=32)
    contract_value: Decimal
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    client: Optional[str] = Field(default=None, min_length=1, max_length=255)
    suburb: Optional[str] = Field(default=None, min_length=1, max_length=128)
    status: Optional[str] = Field(default=None, max_length=32)
    contract_value: Optional[Decimal] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class ProjectCapabilities(BaseModel):
    can_read: bool
    can_manage_project: bool
    can_create_variations: bool
    can_update_variations: bool
    can_create_subcontractors: bool
    can_update_subcontractors: bool
    can_create_claims: bool
    can_update_claims: bool
    can_archive_project: bool


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    client: Optional[str]
    suburb: Optional[str]
    status: str
    contract_value: Decimal
    start_date: Optional[datetime]
    end_date: Optional[datetime]
    is_archived: bool
    archived_at: Optional[datetime]
    forecast_uncommitted_costs: Optional[Decimal]
    created_at: datetime
    updated_at: datetime
    project_role: Optional[str] = None
    capabilities: ProjectCapabilities


class BudgetCategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    category: str
    budget: Decimal
    committed: Decimal
    actual: Decimal


class BudgetUpdate(BaseModel):
    category: Optional[str] = None
    budget: Optional[Decimal] = None
    committed: Optional[Decimal] = None
    actual: Optional[Decimal] = None
