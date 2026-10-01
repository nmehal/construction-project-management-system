revision = '001'
down_revision = None
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

def upgrade():
    op.create_table('users',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('system_role', sa.String(32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email')
    )
    op.create_table('projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('client', sa.String(255)),
        sa.Column('suburb', sa.String(128)),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('contract_value', sa.Numeric(14,2), nullable=False),
        sa.Column('start_date', sa.DateTime(timezone=True)),
        sa.Column('end_date', sa.DateTime(timezone=True)),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('forecast_uncommitted_costs', sa.Numeric(14,2), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('project_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_role', sa.String(32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'user_id', name='uq_project_user')
    )
    op.create_table('variations',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('description', sa.String(1000), nullable=False),
        sa.Column('requested_by', sa.String(255)),
        sa.Column('cost_change', sa.Numeric(14,2), nullable=False),
        sa.Column('margin', sa.Numeric(14,2), nullable=False, server_default=sa.text('0')),
        sa.Column('total', sa.Numeric(14,2), nullable=False),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('approval_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('subcontractors',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('trade', sa.String(128), nullable=False),
        sa.Column('company', sa.String(255), nullable=False),
        sa.Column('scope', sa.String(1000)),
        sa.Column('allowance', sa.Numeric(14,2), nullable=False),
        sa.Column('committed', sa.Numeric(14,2), nullable=False, server_default=sa.text('0')),
        sa.Column('paid', sa.Numeric(14,2), nullable=False, server_default=sa.text('0')),
        sa.Column('status', sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('progress_claims',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('claim_no', sa.String(64), nullable=False),
        sa.Column('stage', sa.String(128)),
        sa.Column('date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('amount', sa.Numeric(14,2), nullable=False),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('paid_date', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('budget_categories',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('category', sa.String(128), nullable=False),
        sa.Column('budget', sa.Numeric(14,2), nullable=False),
        sa.Column('committed', sa.Numeric(14,2), nullable=False, server_default=sa.text('0')),
        sa.Column('actual', sa.Numeric(14,2), nullable=False, server_default=sa.text('0')),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('refresh_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(255), nullable=False),
        sa.Column('revoked', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

def downgrade():
    op.drop_table('refresh_sessions')
    op.drop_table('budget_categories')
    op.drop_table('progress_claims')
    op.drop_table('subcontractors')
    op.drop_table('variations')
    op.drop_table('project_members')
    op.drop_table('projects')
    op.drop_table('users')
