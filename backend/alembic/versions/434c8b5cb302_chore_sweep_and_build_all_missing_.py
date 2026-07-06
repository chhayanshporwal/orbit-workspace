"""chore: sweep and build all missing database models

Revision ID: 434c8b5cb302
Revises: 688e0454f8e4
Create Date: 2026-07-06 20:11:30.501247

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "434c8b5cb302"
down_revision: Union[str, Sequence[str], None] = "688e0454f8e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user_project_views",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_user_project_views_id"), "user_project_views", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_user_project_views_project_id"),
        "user_project_views",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_project_views_user_id"),
        "user_project_views",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        op.f("ix_user_project_views_user_id"), table_name="user_project_views"
    )
    op.drop_index(
        op.f("ix_user_project_views_project_id"), table_name="user_project_views"
    )
    op.drop_index(op.f("ix_user_project_views_id"), table_name="user_project_views")
    op.drop_table("user_project_views")
