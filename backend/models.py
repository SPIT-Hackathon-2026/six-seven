"""
SQLAlchemy ORM models.
"""

import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    String,
    Text,
    DateTime,
    Boolean,
    Integer,
    ForeignKey,
    Enum,
    JSON,
)
from sqlalchemy.orm import relationship
from database import Base


# ── helpers ──────────────────────────────────────────────────────────


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── enums ────────────────────────────────────────────────────────────


class SyncActionType(str, enum.Enum):
    PUSH_COMMITS = "push_commits"
    CREATE_BRANCH = "create_branch"
    DELETE_BRANCH = "delete_branch"
    RENAME_BRANCH = "rename_branch"
    CREATE_TAG = "create_tag"
    DELETE_TAG = "delete_tag"
    MERGE_BRANCH = "merge_branch"
    FORCE_PUSH = "force_push"
    FULL_SYNC = "full_sync"
    PATCH_SYNC = "patch_sync"


class SyncStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CONFLICT = "conflict"


class SyncDirection(str, enum.Enum):
    PUSH = "push"
    PULL = "pull"


# ── models ───────────────────────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    github_token = Column(Text, nullable=True)  # encrypted PAT / OAuth token
    github_username = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    # relationships
    repos = relationship(
        "Repository", back_populates="owner", cascade="all, delete-orphan"
    )
    sync_actions = relationship(
        "SyncAction", back_populates="user", cascade="all, delete-orphan"
    )


class Repository(Base):
    __tablename__ = "repositories"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False, index=True)
    remote_url = Column(Text, nullable=True)  # e.g. https://github.com/user/repo.git
    default_branch = Column(String(100), default="main")
    last_synced_at = Column(DateTime, nullable=True)
    last_synced_oid = Column(String(40), nullable=True)  # last HEAD oid we synced
    is_private = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    # relationships
    owner = relationship("User", back_populates="repos")
    sync_actions = relationship(
        "SyncAction", back_populates="repo", cascade="all, delete-orphan"
    )
    sync_logs = relationship(
        "SyncLog", back_populates="repo", cascade="all, delete-orphan"
    )

    # Composite unique constraint: one repo name per user
    __table_args__ = (
        # UniqueConstraint("user_id", "name", name="uq_user_repo"),
    )


class SyncAction(Base):
    """
    Queue of actions waiting to be synced to the remote.
    The mobile app POSTs these when it comes online.
    """

    __tablename__ = "sync_actions"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    repo_id = Column(
        String, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )

    action_type = Column(Enum(SyncActionType), nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    """
    Payload varies by action_type:
      push_commits  → { "from_oid": "abc", "to_oid": "def", "branch": "main", "bundle_b64": "..." }
      create_branch → { "branch": "feature-x", "from_ref": "main" }
      delete_branch → { "branch": "feature-x" }
      create_tag    → { "tag": "v1.0", "oid": "abc123" }
      patch_sync    → { "from_oid": "abc", "patch_b64": "..." }
      full_sync     → { "bundle_b64": "..." }
    """

    status = Column(
        Enum(SyncStatus), default=SyncStatus.PENDING, nullable=False, index=True
    )
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)

    # ordering – actions MUST be replayed in order
    sequence = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, default=_utcnow)
    synced_at = Column(DateTime, nullable=True)

    # relationships
    user = relationship("User", back_populates="sync_actions")
    repo = relationship("Repository", back_populates="sync_actions")


class SyncLog(Base):
    """
    Audit log of every sync operation (successful or not).
    """

    __tablename__ = "sync_logs"

    id = Column(String, primary_key=True, default=_uuid)
    repo_id = Column(
        String, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    action_id = Column(
        String, ForeignKey("sync_actions.id", ondelete="SET NULL"), nullable=True
    )
    direction = Column(Enum(SyncDirection), nullable=False)
    status = Column(Enum(SyncStatus), nullable=False)
    from_oid = Column(String(40), nullable=True)
    to_oid = Column(String(40), nullable=True)
    files_changed = Column(Integer, default=0)
    details = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=_utcnow)

    # relationships
    repo = relationship("Repository", back_populates="sync_logs")
