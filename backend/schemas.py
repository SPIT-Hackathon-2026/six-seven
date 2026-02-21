"""
Pydantic request / response schemas.
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field

from models import SyncActionType, SyncStatus, SyncDirection


# ── Auth ─────────────────────────────────────────────────────────────


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=6)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    github_username: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class LinkGitHubRequest(BaseModel):
    github_token: str
    github_username: Optional[str] = None


# ── Repository ───────────────────────────────────────────────────────


class RepoCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    remote_url: Optional[str] = None
    default_branch: str = "main"
    is_private: bool = True


class RepoUpdateRequest(BaseModel):
    name: Optional[str] = None
    remote_url: Optional[str] = None
    default_branch: Optional[str] = None
    is_private: Optional[bool] = None


class RepoResponse(BaseModel):
    id: str
    name: str
    remote_url: Optional[str]
    default_branch: str
    last_synced_at: Optional[datetime]
    last_synced_oid: Optional[str]
    is_private: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Sync Actions ─────────────────────────────────────────────────────


class SyncActionRequest(BaseModel):
    """Single queued action from the mobile app."""

    repo_id: str
    action_type: SyncActionType
    payload: dict = Field(default_factory=dict)
    sequence: int = 0
    client_timestamp: Optional[datetime] = None


class SyncBatchRequest(BaseModel):
    """Batch of queued actions submitted when device comes online."""

    repo_id: str
    actions: List[SyncActionRequest]


class SyncActionResponse(BaseModel):
    id: str
    repo_id: str
    action_type: SyncActionType
    status: SyncStatus
    error_message: Optional[str]
    sequence: int
    created_at: datetime
    synced_at: Optional[datetime]

    class Config:
        from_attributes = True


class SyncStatusResponse(BaseModel):
    repo_id: str
    total: int = 0
    pending: int = 0
    processing: int = 0
    completed: int = 0
    failed: int = 0
    conflict: int = 0


class SyncLogResponse(BaseModel):
    id: str
    direction: SyncDirection
    status: str
    from_oid: Optional[str] = None
    to_oid: Optional[str] = None
    files_changed: int = 0
    timestamp: datetime

    class Config:
        from_attributes = True


# ── Push / Pull payloads ─────────────────────────────────────────────


class PushBundleRequest(BaseModel):
    """Full repo bundle push (base64-encoded zip/JSON)."""

    repo_id: str
    branch: str = "main"
    from_oid: Optional[str] = None
    to_oid: str
    bundle_b64: str
    commit_count: int = 0


class PatchPushRequest(BaseModel):
    """Incremental patch push."""

    repo_id: str
    from_oid: str
    to_oid: str
    patch_b64: str  # base64-encoded patch JSON from exportPatchSince


class PullRequest(BaseModel):
    """Device requests updates since a known oid."""

    repo_id: str
    from_oid: Optional[str] = None  # None → full clone
    branch: str = "main"


class PullResponse(BaseModel):
    repo_id: str
    up_to_date: bool = False
    from_oid: Optional[str] = None
    to_oid: Optional[str] = None
    files_changed: int = 0
    files: List[dict] = Field(default_factory=list)
    commits: List[dict] = Field(default_factory=list)
    summary: Optional[dict] = None
