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

def project_access(user: User, db: Session, project: Project) -> dict:
    """Describe the existing module rules; never use this response as authorization."""
    membership = get_project_membership(db, str(user.id), str(project.id))
    role = membership.project_role if membership else None
    admin = user.system_role == "Admin"
    can_read = admin or membership is not None
    manager = admin or role == "Manager"
    # Variations and subcontractors currently allow a system Project Manager
    # with project read access to write regardless of their project role.
    module_manager = can_read and (admin or user.system_role == "Project Manager" or role == "Manager")
    return {
        "project_role": role,
        "capabilities": {
            "can_read": can_read,
            "can_manage_project": manager,
            "can_create_variations": module_manager or (can_read and role == "Contributor"),
            "can_update_variations": module_manager,
            "can_create_subcontractors": module_manager,
            "can_update_subcontractors": module_manager,
            "can_create_claims": manager,
            "can_update_claims": manager,
            "can_archive_project": manager,
        },
    }


def user_can_read_budget(user: User, db: Session, project: Project) -> bool:
    return user_can_read_project(user, db, project)

def user_can_update_budget(user: User, db: Session, project: Project) -> bool:
    if user.system_role == "Admin":
        return True
    membership = get_project_membership(db, str(user.id), str(project.id))
    if membership and membership.project_role == "Manager":
        return True
    return False
