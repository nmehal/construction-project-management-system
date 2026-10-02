from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List

from app.auth.dependencies import get_db, get_current_user, require_system_roles
from app.projects.permissions import user_can_read_project, user_can_update_project
from app.subcontractors.schemas import SubcontractorCreate, SubcontractorResponse
from app.models.users import User, ProjectMember
from app.models.projects import Project
from app.models.subcontractors import Subcontractor

router = APIRouter(prefix="/projects/{project_id}/subcontractors", tags=["subcontractors"])

@router.post("", response_model=SubcontractorResponse)
def create_subcontractor(project_id: str, req: SubcontractorCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    if user.system_role not in ("Admin", "Project Manager"):
        membership = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id).first()
        if not membership or membership.project_role != "Manager":
            raise HTTPException(status_code=403, detail="Access denied")
    subcontractor = Subcontractor(
        project_id=project_id,
        trade=req.trade,
        company=req.company,
        scope=req.scope,
        allowance=req.allowance,
        committed=req.committed,
        paid=req.paid,
        status=req.status,
    )
    db.add(subcontractor)
    db.commit()
    db.refresh(subcontractor)
    return SubcontractorResponse.model_validate(subcontractor)

@router.get("", response_model=List[SubcontractorResponse])
def list_subcontractors(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    subcontractors = db.query(Subcontractor).filter(Subcontractor.project_id == project_id).all()
    return [SubcontractorResponse.model_validate(s) for s in subcontractors]

@router.get("/{subcontractor_id}", response_model=SubcontractorResponse)
def get_subcontractor(project_id: str, subcontractor_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    subcontractor = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id, Subcontractor.project_id == project_id).first()
    if not subcontractor:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    return SubcontractorResponse.model_validate(subcontractor)

@router.patch("/{subcontractor_id}", response_model=SubcontractorResponse)
def update_subcontractor(project_id: str, subcontractor_id: str, req: SubcontractorCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    if user.system_role not in ("Admin", "Project Manager"):
        membership = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id).first()
        if not membership or membership.project_role != "Manager":
            raise HTTPException(status_code=403, detail="Access denied")
    subcontractor = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id, Subcontractor.project_id == project_id).first()
    if not subcontractor:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    if req.trade is not None:
        subcontractor.trade = req.trade
    if req.company is not None:
        subcontractor.company = req.company
    if req.scope is not None:
        subcontractor.scope = req.scope
    if req.allowance is not None:
        subcontractor.allowance = req.allowance
    if req.committed is not None:
        subcontractor.committed = req.committed
    if req.paid is not None:
        subcontractor.paid = req.paid
    if req.status is not None:
        subcontractor.status = req.status
    db.commit()
    db.refresh(subcontractor)
    return SubcontractorResponse.model_validate(subcontractor)
