"""Baseline existing database schema

Revision ID: d41acaa3a35c
Revises:
Create Date: 2026-10-07 23:20:22.567464

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d41acaa3a35c"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=80), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column(
            "password_hash",
            sa.String(length=255),
            nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False
        ),
        sa.PrimaryKeyConstraint("id")
    )

    op.create_index(
        op.f("ix_users_email"),
        "users",
        ["email"],
        unique=True
    )

    op.create_index(
        op.f("ix_users_username"),
        "users",
        ["username"],
        unique=True
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("receiver_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False
        ),
        sa.Column(
            "read_at",
            sa.DateTime(timezone=True),
            nullable=True
        ),
        sa.ForeignKeyConstraint(
            ["receiver_id"],
            ["users.id"],
            ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["sender_id"],
            ["users.id"],
            ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id")
    )

    op.create_index(
        op.f("ix_messages_created_at"),
        "messages",
        ["created_at"],
        unique=False
    )

    op.create_index(
        op.f("ix_messages_receiver_id"),
        "messages",
        ["receiver_id"],
        unique=False
    )

    op.create_index(
        op.f("ix_messages_sender_id"),
        "messages",
        ["sender_id"],
        unique=False
    )


def downgrade():
    op.drop_index(
        op.f("ix_messages_sender_id"),
        table_name="messages"
    )

    op.drop_index(
        op.f("ix_messages_receiver_id"),
        table_name="messages"
    )

    op.drop_index(
        op.f("ix_messages_created_at"),
        table_name="messages"
    )

    op.drop_table("messages")

    op.drop_index(
        op.f("ix_users_username"),
        table_name="users"
    )

    op.drop_index(
        op.f("ix_users_email"),
        table_name="users"
    )

    op.drop_table("users")
