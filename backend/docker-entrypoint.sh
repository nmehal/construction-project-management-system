#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL must be supplied}"
: "${AUTH_SECRET:?AUTH_SECRET must be supplied}"
# Fail before migrating if the application's mandatory secret is invalid.
python -c 'import os; assert len(os.environ["AUTH_SECRET"]) >= 16, "AUTH_SECRET must have at least 16 characters"'
alembic upgrade head
exec "$@"
