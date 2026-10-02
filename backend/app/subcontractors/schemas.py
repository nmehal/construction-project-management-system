from uuid import UUID
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional

class SubcontractorCreate(BaseModel):
    trade: str = Field(min_length=1, max_length=128)
    company: str = Field(min_length=1, max_length=255)
    scope: Optional[str] = Field(default=None, max_length=1000)
    allowance: Decimal
    committed: Decimal = Field(default=Decimal("0"))
    paid: Decimal = Field(default=Decimal("0"))
    status: str = Field(default="active", max_length=32)

class SubcontractorResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    trade: str
    company: str
    scope: Optional[str]
    allowance: Decimal
    committed: Decimal
    paid: Decimal
    status: str
