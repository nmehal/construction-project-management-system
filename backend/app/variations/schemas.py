from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field
from decimal import Decimal
from typing import Optional, Literal
from datetime import datetime

class VariationCreate(BaseModel):
    description: str = Field(min_length=1, max_length=1000)
    requested_by: str = Field(min_length=1, max_length=255)
    cost_change: Decimal
    margin: Decimal = Field(default=Decimal("0"))
    total: Decimal
    status: Literal["Draft", "Submitted", "Pending", "Approved", "Rejected"] = Field(default="Draft")

class VariationUpdate(BaseModel):
    description: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    requested_by: Optional[str] = Field(default=None, max_length=255)
    cost_change: Optional[Decimal] = Field(default=None)
    margin: Optional[Decimal] = Field(default=None)
    total: Optional[Decimal] = Field(default=None)
    status: Optional[Literal["Draft", "Submitted", "Pending", "Approved", "Rejected"]] = Field(default=None)
    approval_date: Optional[datetime] = Field(default=None)

class VariationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    description: str
    requested_by: Optional[str]
    cost_change: Decimal
    margin: Decimal
    total: Decimal
    status: str
    approval_date: Optional[datetime]
