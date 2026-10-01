revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

def upgrade():
    # Add expires_at safely: first nullable, then set default, then non-null
    op.add_column('refresh_sessions', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
    # Set existing rows to a future expiry (safe default for existing session data)
    op.execute("UPDATE refresh_sessions SET expires_at = NOW() + INTERVAL '7 days' WHERE expires_at IS NULL")
    # Make non-null after populating
    op.alter_column('refresh_sessions', 'expires_at', nullable=False)
    # Add unique index on token_hash
    op.create_unique_constraint('uq_refresh_token_hash', 'refresh_sessions', ['token_hash'])

def downgrade():
    op.drop_constraint('uq_refresh_token_hash', 'refresh_sessions', type_='unique')
    op.drop_column('refresh_sessions', 'expires_at')
