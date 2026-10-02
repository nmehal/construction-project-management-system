from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from decimal import Decimal

from app.auth.dependencies import get_db, get_current_user, require_system_roles
from app.variations.schemas import VariationCreate, VariationUpdate, VariationResponse
from app.projects.permissions import user_can_read_project, user_can_update_project
from app.models.users import User, ProjectMember
from app.models.projects import Project
from app.models.variations import Variation
from datetime import datetime, timezone

router = APIRouter(prefix="/projects/{project_id}/variations", tags=["variations"])

@router.post("", response_model=VariationResponse)
def create_variation(project_id: str, req: VariationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    if user.system_role not in ("Admin", "Project Manager"):
        membership = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id).first()
        if not membership or membership.project_role not in ("Manager", "Contributor"):
            raise HTTPException(status_code=403, detail="Access denied")
    total = Decimal(str(req.cost_change)) + Decimal(str(req.margin))
    variation = Variation(
        project_id=project_id,
        description=req.description,
        requested_by=req.requested_by,
        cost_change=req.cost_change,
        margin=req.margin,
        total=total,
        status=req.status,
    )
    db.add(variation)
    db.commit()
    db.refresh(variation)
    return VariationResponse.model_validate(variation)

@router.get("", response_model=List[VariationResponse])
def list_variations(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    variations = db.query(Variation).filter(Variation.project_id == project_id).all()
    return [VariationResponse.model_validate(v) for v in variations]

@router.get("/{variation_id}", response_model=VariationResponse)
def get_variation(project_id: str, variation_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    variation = db.query(Variation).filter(Variation.id == variation_id, Variation.project_id == project_id).first()
    if not variation:
        raise HTTPException(status_code=404, detail="Variation not found")
    return VariationResponse.model_validate(variation)

@router.patch("/{variation_id}", response_model=VariationResponse)
def update_variation(project_id: str, variation_id: str, req: VariationUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    # Only Admin / Project Manager can update; Contributor/Viewer denied
    if user.system_role not in ("Admin", "Project Manager"):
        membership = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id).first()
        if not membership or membership.project_role != "Manager":
            raise HTTPException(status_code=403, detail="Access denied")
    variation = db.query(Variation).filter(Variation.id == variation_id, Variation.project_id == project_id).first()
    if not variation:
        raise HTTPException(status_code=404, detail="Variation not found")
    if req.description is not None:
        variation.description = req.description
    if req.requested_by is not None:
        variation.requested_by = req.requested_by
    if req.cost_change is not None:
        variation.cost_change = req.cost_change
    if req.margin is not None:
        variation.margin = req.margin
    if req.total is not None:
        variation.total = req.total
    if req.status is not None:
        if req.status not in ("Draft", "Submitted", "Pending", "Approved", "Rejected"):
            raise HTTPException(status_code=422, detail="Invalid status")
        variation.status = req.status
        if req.status == "Approved" and req.approval_date is None:
            variation.approval_date = datetime.now(timezone.utc)
        elif req.approval_date is not None:
            variation.approval_date = req.approval_date
    if req.cost_change is not None or req.margin is not None:
        # Recalculate total when components change
        if req.cost_change is not None and req.margin is not None:
            variation.total = Decimal(str(req.cost_change)) + Decimal(str(req.margin))
        elif req.cost_change is not None:
            variation.total = Decimal(str(req.cost_change)) + Decimal(str(variation.margin))
        elif req.margin is not None:
            variation.total = Decimal(str(variation.cost_change)) + Decimal(str(req.margin))
    db.commit()
    db.refresh(variation)
    return VariationResponse.model_validate(variation)
