from sqlalchemy import Numeric, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid
from .base import Base

class Variation(Base):
    __tablename__ = "variations"
    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(255), nullable=False)
    cost_change: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    margin: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)  # Draft / Submitted / Pending / Approved / Rejected
    approval_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", onupdate="now()")
