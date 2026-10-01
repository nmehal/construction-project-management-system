from sqlalchemy import Numeric, String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from .base import Base

class BudgetCategory(Base):
    __tablename__ = "budget_categories"
    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    project_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    category: Mapped[str] = mapped_column(String(128), nullable=False)
    budget: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    committed: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    actual: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
