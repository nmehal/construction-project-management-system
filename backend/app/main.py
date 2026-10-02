from fastapi import FastAPI
from app.auth.routes import router as auth_router
from app.projects.routes import router as projects_router
from app.variations.routes import router as variations_router
from app.subcontractors.routes import router as subcontractors_router

app = FastAPI()
app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(variations_router)
app.include_router(subcontractors_router)
