from uuid import UUID
from decimal import Decimal
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict, Field

class ClaimCreate(BaseModel):
    claim_no: str = Field(min_length=1, max_length=64)
    stage: Optional[str] = Field(default=None, max_length=128)
    date: datetime
    amount: Decimal
    status: Literal["Draft", "Issued", "Paid", "Overdue"] = Field(default="Draft")
    paid_date: Optional[datetime] = Field(default=None)

class ClaimUpdate(BaseModel):
    claim_no: Optional[str] = Field(default=None, min_length=1, max_length=64)
    stage: Optional[str] = Field(default=None, max_length=128)
    date: Optional[datetime] = Field(default=None)
    amount: Optional[Decimal] = Field(default=None)
    status: Optional[Literal["Draft", "Issued", "Paid", "Overdue"]] = Field(default=None)
    paid_date: Optional[datetime] = Field(default=None)

class ClaimResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    claim_no: str
    stage: Optional[str]
    date: datetime
    amount: Decimal
    status: Literal["Draft", "Issued", "Paid", "Overdue"]
    paid_date: Optional[datetime]
