# Docker deployment and operations (Stage7D)

Fictional portfolio/demo only; no real client data. This is a single-host,
single-backend deployment, not a high-availability or managed production service.

## Prerequisites and existing-stack identity

Use Docker Engine with Compose v2, enough disk for images/database/backups, and
port 8080 available to the intended ingress. Node matching `frontend/package.json`
is required only for host-side tests. TLS termination and certificate renewal are
operator responsibilities. Keep Docker administration restricted: it is root-equivalent.

Work from this repository root. **Identify the existing project before running
anything that changes state**; do not invent a new namespace to bypass an error:

```sh
docker compose ls
docker ps --format '{{.Names}}	{{.Labels}}	{{.Ports}}'
export COMPOSE_PROJECT_NAME='<existing project label>'
export DOCKER_ENV="$HOME/.config/construction-stage7a.env"
# Use the existing external file and any existing override files consistently.
docker compose --env-file "$DOCKER_ENV" ps -a
```

`compose.yaml` defaults to `construction-stage7a`, but an existing installation
may use a different project label. Confirm its repository/config files, containers
and volume before proceeding. Never attach, modify or delete the unrelated
`construction-postgres` container/volumes. Do not create a replacement database
when Docker or the existing stack is inaccessible.

## Environment and secrets

Use `.env.example` as a key reference, not deployable credentials. Keep the existing
development `.env` unchanged. Store deployment values outside Git in a mode-600
file, with a restricted parent directory; do not commit, print, paste into logs,
or include secrets in image builds. Docker build allowlists exclude env files.
Use `config --quiet`, not rendered `config` or unrestricted container inspection.

- `POSTGRES_PASSWORD`: unique, cryptographically random, URL-safe hexadecimal value
  (recommended: 32 random bytes encoded as 64 hex characters).
- `AUTH_SECRET`: a separate random 64-character hex value; the application's
  16-character minimum is not a production recommendation. Generate through a
  trusted local secret tool, not this document or a shared example.
- `POSTGRES_USER`: URL-safe letters/digits/underscores; database is fixed to
  `construction_db`, service address `postgres:5432`, never host localhost.
- `COOKIE_SECURE=true` for HTTPS. `false` is only for local HTTP development.
- `ACCESS_TOKEN_EXPIRE_MINUTES=15`, `REFRESH_TOKEN_EXPIRE_DAYS=7` are defaults;
  choose finite positive lifetimes appropriate to the deployment. Do not lengthen
  expiry to work around login issues. Secret rotation invalidates signed access
  tokens, not database-backed refresh sessions; it is not a full session revocation.
- `FRONTEND_BIND_IP`: default `0.0.0.0` preserves local LAN/sandbox access; for a
  same-host TLS reverse proxy set `127.0.0.1`. Never expose the HTTP upstream to
  the public Internet in a production deployment.
- `FORWARDED_ALLOW_IPS`: defaults to loopback (no trust of other containers).
  For production, allow only the exact frontend container IP(s), as below.

Changing the password in the env file **does not rotate an initialized PostgreSQL
role password**. Coordinate database-side credential rotation and backend config
separately; never discard a volume to make new credentials work.

## TLS and proxy trust boundary

```text
Internet HTTPS -> operator TLS reverse proxy -> frontend nginx:80
                -> backend:8000 -> postgres:5432 (named volume)
```

Only frontend publishes a host port (8080). Backend `expose: 8000` is internal
metadata, not a published port; PostgreSQL has no host port. The Compose network
is not a security boundary against administrators or other attached containers:
keep it exclusive to these services; do not attach untrusted workloads.

A practical provider-neutral production setup is a TLS proxy on the same host,
forwarding exclusively to `127.0.0.1:8080`, with
`FRONTEND_BIND_IP=127.0.0.1`. Validate allowed public Host names at the edge, redirect
public HTTP to HTTPS, and overwrite (never append untrusted input to) forwarding
headers. If the proxy is elsewhere, bind to a private interface and enforce a
Docker-aware firewall/ingress allowlist for that proxy only. Do not assume a host
firewall automatically filters Docker-published ports.

The checked-in nginx config is deliberately for HTTP: it sets
`X-Forwarded-Proto $scheme` and **ignores client-supplied forwarding headers**.
For an HTTPS-only deployment, use a reviewed production copy of
`frontend/nginx.conf`, change only that directive to
`proxy_set_header X-Forwarded-Proto https;`, and mount that full config read-only
at `/etc/nginx/conf.d/default.conf` using an operator-managed Compose override.
Use that same override on every Compose command. This fixed scheme is safe only
when the frontend is reachable solely through the HTTPS ingress (plus trusted
local health checks). Never replace it with `$http_x_forwarded_proto` on an
unrestricted listener. Keep all SPA/API routing and health locations unchanged.

nginx replaces `X-Forwarded-For` with its direct peer, intentionally sacrificing
original client-IP attribution instead of trusting arbitrary header chains.
Uvicorn no longer trusts `*`. Identify the frontend IP without exposing env values:

```sh
frontend_id=$(docker compose --env-file "$DOCKER_ENV" ps -q frontend)
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{println}}{{end}}' "$frontend_id"
```

Set `FORWARDED_ALLOW_IPS` in the external env file to that exact IP, then recreate
**backend only** with `up -d --no-deps backend`. Recheck whenever frontend is
recreated: its IP may change. For stable production operation reserve a frontend
IP on a dedicated, non-overlapping operator-managed Compose network/override,
then allow that exact IP. Do not use `*`, broad private CIDRs, or shared-network
trust. Until configured, forwarding is ignored and HTTPS redirects may be wrong;
do not advertise the deployment before validating them. No auth or CORS changes
are needed: browser SPA and API remain same-origin. Never add permissive CORS to
compensate for an incorrect proxy origin.

## Deploy, inspect and operate

After confirming the existing stack, external env and required overrides:

```sh
docker compose --env-file "$DOCKER_ENV" config --quiet
docker compose --env-file "$DOCKER_ENV" build backend frontend
docker compose --env-file "$DOCKER_ENV" up -d
docker compose --env-file "$DOCKER_ENV" ps
docker compose --env-file "$DOCKER_ENV" logs --tail=100 frontend backend postgres
docker compose --env-file "$DOCKER_ENV" exec -T frontend nginx -t
docker compose --env-file "$DOCKER_ENV" exec -T backend alembic current
docker compose --env-file "$DOCKER_ENV" exec -T backend alembic heads
# Operational restart only (does not apply changed env or rebuilt images):
docker compose --env-file "$DOCKER_ENV" restart frontend backend
# Planned stop/start without removing containers:
docker compose --env-file "$DOCKER_ENV" stop
docker compose --env-file "$DOCKER_ENV" start
# Remove only this project's containers/network; named database volume remains:
docker compose --env-file "$DOCKER_ENV" down
```

Use `up -d` to apply config/image changes, not `restart`. All services use
`restart: unless-stopped`: crashes/daemon restarts are covered, manually stopped
containers stay stopped. An unhealthy status alone does **not** restart a container.
Review logs privately; redact sensitive data before sharing.

**Never use `down -v`, volume removal, or prune for normal operations.** These can
permanently destroy data. Do not run against another project or development DB.

Healthchecks remain: `pg_isready`; backend HTTP `/openapi.json` plus SQL `SELECT 1`;
frontend `/healthz`. `/healthz` only proves nginx is serving, not backend/DB health.
Backend runs as non-root and executes `alembic upgrade head` before serving.
Failure stops startup; restart policy may retry, so investigate migration errors.
Only one backend replica is supported; migration concurrency is not coordinated.

## Identify storage and make backups

Do not guess volume identity from a name alone:

```sh
pg_id=$(docker compose --env-file "$DOCKER_ENV" ps -q postgres)
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$pg_id"
docker volume ls --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME"   --filter 'label=com.docker.compose.volume=postgres_data'
```

The logical volume is `postgres_data`, usually `<project>_postgres_data`.
Confirm mount and Compose labels agree. Do not copy a running database's raw data
directory as a logical backup. Use PostgreSQL 16's in-container tools and existing
container credentials, not passwords in shell arguments. Example operator-only
procedure (not automatically executed):

```sh
# Bash; run in a dedicated shell, stop on errors.
set -eu
# Use a private location outside the repository on adequate storage.
umask 077
export BACKUP_DIR="$HOME/private-construction-backups"
mkdir -p "$BACKUP_DIR"
backup_run=$(mktemp -d "$BACKUP_DIR/construction-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
backup="$backup_run/construction.dump"
# noclobber prevents accidentally overwriting an existing archive.
if (set -C; docker compose --env-file "$DOCKER_ENV" exec -T postgres   sh -c 'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-acl'   > "$backup.partial"); then
  mv -n "$backup.partial" "$backup"
else
  printf 'Backup failed; keep partial file separate and investigate.\n' >&2
  exit 1
fi
test -s "$backup"
docker compose --env-file "$DOCKER_ENV" exec -T postgres pg_restore --list < "$backup" > /dev/null
sha256sum "$backup"
```

Check command exit statuses; a nonempty archive/listing is **not** a tested restore.
`pg_dump` takes a consistent database snapshot while the app runs. For an upgrade
recovery point, stop application writes first and keep them stopped until the
upgrade is accepted or rollback completed. Store encrypted off-host copies with
restricted access, retention and verified checksums. Back up operator config and
secrets separately in a secure store. Dumps contain application data and auth
session records; treat them as secrets. This single-database dump omits cluster
roles/global objects; recreate required roles separately. It is not point-in-time
recovery and cannot recover writes after the snapshot.

## Restore rehearsal and recovery

Restore regularly into a **separate, explicitly approved recovery PostgreSQL 16
instance**, never the running app database or `construction-postgres`. Do not use
a guessed container/project name. Example after the operator has provisioned an
empty recovery instance with its own private credentials:

```sh
# Dedicated operator shell; stop immediately on failure.
set -eu
export RESTORE_CONTAINER='<approved isolated recovery container>'
# Confirm identity/mounts first; do not inspect or print its environment.
docker inspect --format '{{.Name}} {{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}' "$RESTORE_CONTAINER"
# Fails if the scratch database already exists; do not drop it to bypass errors.
docker exec "$RESTORE_CONTAINER" sh -c   'createdb --username="$POSTGRES_USER" construction_restore_check'
docker exec -i "$RESTORE_CONTAINER" sh -c   'pg_restore --username="$POSTGRES_USER" --dbname=construction_restore_check --no-owner --no-acl --exit-on-error --single-transaction'   < "$backup"
docker exec "$RESTORE_CONTAINER" sh -c   'psql --username="$POSTGRES_USER" --dbname=construction_restore_check --set=ON_ERROR_STOP=1 --command="SELECT version_num FROM alembic_version;"'
```

Check every exit status. A failed restore is not usable. Validate expected tables,
record counts and representative financial totals against the backup's source,
then exercise a matching application release in the isolated recovery environment
(login, refresh, project reads and financial workflow). Prevent external users
from reaching the recovery instance. Document duration and recovery point; only
then call the backup recoverable. No restore/backup is executed by this stage.

Actual recovery requires an approved maintenance window: stop writes, retain the
failed volume and current recovery snapshot, restore to a separate empty target,
validate, and deliberately switch the matching app to it. Never restore over a
live database or use `--clean`/drop commands as a shortcut. Reconcile any writes
since the snapshot before reopening traffic.

## Upgrades and rollback

Record the current Git revision, image IDs/digests, env/override versions and
migration head. Retain previous images and a tested pre-upgrade backup. Floating
base-image tags can change; rebuilding an old Git revision is not guaranteed to
reproduce an old image. Review dependency/base-image and migration changes before
building, rehearse against a restored copy, then deploy during planned downtime.
Do not change the PostgreSQL major version against an existing volume; that needs
a separately planned `pg_upgrade` or dump/restore migration.

Startup automatically applies migrations. Returning to an older image does **not**
undo schema/data migrations. App-only rollback is safe only if the old code is
compatible with the current schema. Otherwise restore the tested pre-upgrade
backup into a separate target and use the matching old release; later writes may
be lost and must be reconciled. Do not assume Alembic downgrade is lossless or
supported. Never run concurrent migrating backends.

## Release validation checklist

- [ ] Correct existing project, volume, env and overrides; `config --quiet` passes.
- [ ] Build/up succeed; `ps` shows all three healthy. Migration current equals heads
      (`002` at this revision); no migration/restart loop.
- [ ] `nginx -t` passes; only frontend publishes 8080. Check `docker compose ps`
      and `docker inspect --format '{{json .NetworkSettings.Ports}}'` for each
      service; backend/PG mappings must be null/absent, not host bindings.
- [ ] Public HTTPS uses valid certificates; HTTP redirects; frontend upstream is
      inaccessible to untrusted peers. Forged forwarding headers cannot alter
      HTTPS redirects; frontend IP matches backend's explicit trust setting.
- [ ] Set `BASE_URL` to the actual reachable origin and run read-only probes:

```sh
export BASE_URL='http://127.0.0.1:8080' # use public https:// origin in production
curl -i "$BASE_URL/healthz"                              # 200, ok
curl -i -H 'Accept: application/json' "$BASE_URL/auth/me" # 401, JSON
curl -i -H 'Accept: text/html' "$BASE_URL/projects/1/claims" # 200, SPA HTML
```

- [ ] Same-origin login/refresh/logout work; HTTPS refresh cookie has Secure,
      HttpOnly and intended SameSite behavior; no token/credential logging.
- [ ] Nested SPA refresh works; anonymous JSON API never returns the HTML shell.
      `Vary: Accept` and the API/SPA negotiation must remain intact.
- [ ] `cd frontend && npm test -- --run` and `npm run build` pass.
- [ ] Run credentialed E2E only on the approved demo workspace per
      `frontend/e2e/README.md`; it writes fictional records. Missing credentials
      means not run, not passed. Prior user-verified E2E is not a fresh execution.
- [ ] Tested restore, off-host backup, previous images and rollback plan exist.
- [ ] `git diff --check` passes; no secrets or unrelated changes staged.
