from fastapi import FastAPI
from app.auth.routes import router as auth_router
from app.projects.routes import router as projects_router

app = FastAPI()
app.include_router(auth_router)
app.include_router(projects_router)
