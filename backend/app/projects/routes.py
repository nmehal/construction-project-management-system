from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from app.auth.dependencies import get_db, get_current_user, require_system_roles
from app.projects.schemas import ProjectCreate, ProjectResponse, BudgetUpdate
from app.projects.permissions import (
    user_can_read_project, user_can_update_project,
    user_can_read_budget, user_can_update_budget,
)
from app.models.users import User, ProjectMember
from app.models.projects import Project
from app.models.budgets import BudgetCategory
from datetime import datetime, timezone

router = APIRouter(prefix="/projects", tags=["projects"])

# Helper: include archived if requested
ARCHIVE_PARAM = Optional[bool]

@router.post("", response_model=ProjectResponse)
def create_project(req: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Only Admin or Project Manager can create
    if user.system_role not in ("Admin", "Project Manager"):
        raise HTTPException(status_code=403, detail="Insufficient privileges to create project")
    project = Project(
        name=req.name,
        client=req.client,
        suburb=req.suburb,
        status=req.status,
        contract_value=req.contract_value,
        start_date=req.start_date,
        end_date=req.end_date,
        is_archived=False,
        forecast_uncommitted_costs=req.contract_value if req.contract_value else None,
    )
    db.add(project)
    db.flush()  # get UUID
    # Auto-add creator as Manager
    membership = ProjectMember(
        project_id=project.id,
        user_id=user.id,
        project_role="Manager",
    )
    db.add(membership)
    db.commit()
    db.refresh(project)
    return ProjectResponse.model_validate(project)

@router.get("", response_model=List[ProjectResponse])
def list_projects(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    include_archived: bool = Query(False, description="Include archived projects"),
):
    from sqlalchemy import or_
    # Admin sees all active; Project Manager sees member projects; Viewer sees member projects
    query = db.query(Project)
    if user.system_role == "Admin":
        if not include_archived:
            query = query.filter(Project.is_archived == False)
    else:
        # Members see their own
        query = query.join(ProjectMember, Project.id == ProjectMember.project_id).filter(
            ProjectMember.user_id == user.id
        )
        if not include_archived:
            query = query.filter(Project.is_archived == False)
    return [ProjectResponse.model_validate(p) for p in query.all()]

@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    return ProjectResponse.model_validate(project)

@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, req: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_update_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    if req.name is not None:
        project.name = req.name
    if req.client is not None:
        project.client = req.client
    if req.suburb is not None:
        project.suburb = req.suburb
    if req.status is not None:
        project.status = req.status
    if req.contract_value is not None:
        project.contract_value = req.contract_value
    if req.start_date is not None:
        project.start_date = req.start_date
    if req.end_date is not None:
        project.end_date = req.end_date
    db.commit()
    db.refresh(project)
    return ProjectResponse.model_validate(project)

@router.post("/{project_id}/archive", response_model=ProjectResponse)
def archive_project(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_update_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    project.is_archived = True
    project.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return ProjectResponse.model_validate(project)

@router.get("/{project_id}/budget", response_model=list)
def get_project_budget(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_budget(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    categories = db.query(BudgetCategory).filter(BudgetCategory.project_id == project_id).all()
    return [{"id": str(c.id), "category": c.category, "budget": float(c.budget), "committed": float(c.committed), "actual": float(c.actual)} for c in categories]

@router.patch("/{project_id}/budget")
def update_project_budget(project_id: str, req: BudgetUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_update_budget(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    # For simplicity, assume updating a single category by name or creating if needed
    # Actual implementation could vary; we apply updates to all matching or first category
    categories = db.query(BudgetCategory).filter(BudgetCategory.project_id == project_id).all()
    for cat in categories:
        if req.category and cat.category == req.category:
            if req.budget is not None:
                cat.budget = req.budget
            if req.committed is not None:
                cat.committed = req.committed
            if req.actual is not None:
                cat.actual = req.actual
    db.commit()
    return {"message": "Budget updated"}
