from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List

from app.auth.dependencies import get_db, get_current_user, require_system_roles
from app.claims.schemas import ClaimCreate, ClaimUpdate, ClaimResponse
from app.projects.permissions import user_can_read_project, user_can_update_project
from app.models.users import User, ProjectMember
from app.models.projects import Project
from app.models.claims import ProgressClaim
from datetime import datetime, timezone

router = APIRouter(prefix="/projects/{project_id}/claims", tags=["claims"])

@router.post("", response_model=ClaimResponse)
def create_claim(project_id: str, req: ClaimCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    # Create authorization: Admin allowed globally; non-Admin requires exact Manager membership
    if user.system_role != "Admin":
        membership = db.query(ProjectMember).filter(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        ).first()
        if not membership or membership.project_role != "Manager":
            raise HTTPException(status_code=403, detail="Access denied")
    paid_date = None
    if req.status == "Paid" and req.paid_date is None:
        paid_date = datetime.now(timezone.utc)
    elif req.paid_date is not None:
        paid_date = req.paid_date
    claim = ProgressClaim(
        project_id=project_id,
        claim_no=req.claim_no,
        stage=req.stage,
        date=req.date,
        amount=req.amount,
        status=req.status,
        paid_date=paid_date,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    return ClaimResponse.model_validate(claim)

@router.get("", response_model=List[ClaimResponse])
def list_claims(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    claims = db.query(ProgressClaim).filter(ProgressClaim.project_id == project_id).all()
    return [ClaimResponse.model_validate(c) for c in claims]

@router.get("/{claim_id}", response_model=ClaimResponse)
def get_claim(project_id: str, claim_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    claim = db.query(ProgressClaim).filter(ProgressClaim.id == claim_id, ProgressClaim.project_id == project_id).first()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    return ClaimResponse.model_validate(claim)

@router.patch("/{claim_id}", response_model=ClaimResponse)
def update_claim(project_id: str, claim_id: str, req: ClaimUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user_can_read_project(user, db, project):
        raise HTTPException(status_code=403, detail="Access denied")
    # Update authorization: Admin allowed globally; non-Admin requires exact Manager membership
    if user.system_role != "Admin":
        membership = db.query(ProjectMember).filter(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        ).first()
        if not membership or membership.project_role != "Manager":
            raise HTTPException(status_code=403, detail="Access denied")
    claim = db.query(ProgressClaim).filter(ProgressClaim.id == claim_id, ProgressClaim.project_id == project_id).first()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if req.status is not None:
        claim.status = req.status
        if req.status == "Paid":
            if req.paid_date is not None:
                claim.paid_date = req.paid_date
            elif claim.paid_date is None:
                claim.paid_date = datetime.now(timezone.utc)
    if req.paid_date is not None and req.status != "Paid":
        claim.paid_date = req.paid_date
    if req.claim_no is not None:
        claim.claim_no = req.claim_no
    if req.stage is not None:
        claim.stage = req.stage
    if req.date is not None:
        claim.date = req.date
    if req.amount is not None:
        claim.amount = req.amount
    db.commit()
    db.refresh(claim)
    return ClaimResponse.model_validate(claim)
