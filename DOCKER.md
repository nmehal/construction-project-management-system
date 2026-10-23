# Local Docker foundation (Stage7A)

Fictional portfolio/demo project only; no real client data. Requires Docker Engine
and Docker Compose v2, with localhost port 8080 free. No app test suite is run by
these commands. This is local HTTP, not a production deployment.

## Start an isolated stack

Do not change the existing development `.env`. Store Docker secrets in an external
file (for example `$HOME/.config/construction-stage7a.env`), mode 600, using the
keys in `.env.example`. Set `POSTGRES_PASSWORD` to a random **hexadecimal** value
(e.g. Python `secrets.token_hex(32)`) and `AUTH_SECRET` to an independent random
value of at least 16 characters. Blank secrets fail Compose validation. Hex avoids
URL encoding and Alembic interpolation issues. Never print rendered Compose
configuration with real secrets; use `config --quiet`.

From the repository root, set the file path and a fresh project namespace:

```sh
export DOCKER_ENV="$HOME/.config/construction-stage7a.env"
export COMPOSE_PROJECT_NAME=construction-stage7a-local
# Check this namespace is unused BEFORE first startup; choose another if occupied.
docker compose --env-file "$DOCKER_ENV" ps -a
docker volume ls --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME"
docker compose --env-file "$DOCKER_ENV" config --quiet
docker compose --env-file "$DOCKER_ENV" build backend frontend
docker compose --env-file "$DOCKER_ENV" up -d --wait --wait-timeout 180
docker compose --env-file "$DOCKER_ENV" ps
```

Open http://localhost:8080. PostgreSQL 16 uses its own Compose-scoped
`postgres_data` volume (`<project>_postgres_data`) and database `construction_db`.
Neither PostgreSQL nor backend port 8000 is published to the host. Only nginx is
published, on `127.0.0.1:8080`. No external volume or fixed container name is used;
never attach or delete the existing `construction-postgres` container/volumes.
The backend URL always targets service `postgres`, not localhost.

Backend: Python 3.11, existing pinned `requirements.txt`, plus pinned Docker-only
ASGI runtime `uvicorn==0.34.3`; system `libpq5` supports the existing `psycopg`
requirement. Non-root app process runs `alembic upgrade head` before
`uvicorn app.main:app`. Failure stops startup. Only one backend replica is intended
(migration concurrency is not handled). Frontend: Node 22 `npm ci`/Vite build,
then nginx serves only the built assets. Build contexts exclude local env files.
Health checks cover PostgreSQL readiness, backend HTTP + DB connectivity, and nginx.

## Verify routing and migrations

```sh
docker compose --env-file "$DOCKER_ENV" exec -T backend alembic current
docker compose --env-file "$DOCKER_ENV" exec -T backend alembic heads
curl -i http://localhost:8080/healthz
curl -i -H 'Accept: application/json' http://localhost:8080/projects
curl -i -H 'Accept: application/json' http://localhost:8080/auth/me
curl -i -X POST -H 'Accept: application/json' http://localhost:8080/auth/refresh
curl -i -H 'Accept: text/html' 'http://localhost:8080/projects?view=all'
curl -i -H 'Accept: text/html' http://localhost:8080/projects/1/claims
curl -i -H 'Accept: text/html' http://localhost:8080/projects/1/variations
curl -i -H 'Accept: application/json' http://localhost:8080/projects/1/claims
curl -i -H 'Accept: application/json' http://localhost:8080/projects/1/variations
```

Migration current must equal heads (`002` in this revision). Anonymous protected
API calls should return JSON authorization errors, never the HTML entry point.
HTML GET/HEAD navigation on `/auth` and `/projects` (including nested paths,
trailing slash and query strings) serves the SPA. Other methods and non-HTML
requests on those prefixes proxy unchanged to FastAPI. `Vary: Accept` prevents
caches mixing representations. `/projects-other` is not an API prefix.
Refreshing claims/variations pages should load the SPA; an anonymous user is then
redirected to login by the existing React auth guard. Actual authenticated feature
flows are not verified by HTTP shell checks. `/auth/refresh` remains an API POST.

`COOKIE_SECURE=false` is for local HTTP only. Production TLS, secure cookies,
backup/restore, deployment, CI, scaling, and Stage7B live authenticated acceptance
are outside this foundation. Stop only this project with
`docker compose --env-file "$DOCKER_ENV" down` (no `-v`); data remains. Do not prune
or remove volumes. Existing development databases and test databases are untouched.
