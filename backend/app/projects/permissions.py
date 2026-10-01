from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.users import User, ProjectMember
from app.models.projects import Project

def get_project_membership(db: Session, user_id: str, project_id: str) -> ProjectMember:
    return db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id
    ).first()

def user_can_read_project(user: User, db: Session, project: Project) -> bool:
    if user.system_role == "Admin":
        return True
    membership = get_project_membership(db, str(user.id), str(project.id))
    if membership:
        return True
    return False

def user_can_update_project(user: User, db: Session, project: Project) -> bool:
    if user.system_role == "Admin":
        return True
    membership = get_project_membership(db, str(user.id), str(project.id))
    if membership and membership.project_role == "Manager":
        return True
    return False

def user_can_read_budget(user: User, db: Session, project: Project) -> bool:
    return user_can_read_project(user, db, project)

def user_can_update_budget(user: User, db: Session, project: Project) -> bool:
    if user.system_role == "Admin":
        return True
    membership = get_project_membership(db, str(user.id), str(project.id))
    if membership and membership.project_role == "Manager":
        return True
    return False
