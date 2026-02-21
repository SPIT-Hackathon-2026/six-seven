"""
Sync queue router – submit actions, process queue, pull updates.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, SyncActionType
from schemas import (
    SyncActionRequest,
    SyncBatchRequest,
    SyncActionResponse,
    SyncStatusResponse,
    SyncLogResponse,
    PullRequest,
    PullResponse,
)
from auth.utils import get_current_user
from services.sync_service import SyncService
from services.github_service import GitHubService

router = APIRouter(prefix="/sync", tags=["sync"])


# ── Helpers ─────────────────────────────────────────────────────────


def _gh(db, user):
    if not user.github_token:
        raise HTTPException(status_code=400, detail="GitHub account not linked")
    return GitHubService(db, user)


# ── Enqueue ─────────────────────────────────────────────────────────


@router.post("/queue", response_model=SyncActionResponse, status_code=201)
async def enqueue_action(
    body: SyncActionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a single action to the sync queue."""
    svc = SyncService(db)
    action = await svc.enqueue(
        user_id=current_user.id,
        repo_id=body.repo_id,
        action_type=SyncActionType(body.action_type),
        payload=body.payload,
    )
    return action


@router.post("/queue/batch", response_model=List[SyncActionResponse], status_code=201)
async def enqueue_batch(
    body: SyncBatchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit multiple ordered actions at once."""
    svc = SyncService(db)
    actions = await svc.enqueue_batch(
        user_id=current_user.id,
        repo_id=body.repo_id,
        actions=[a.model_dump() for a in body.actions],
    )
    return actions


# ── Process ─────────────────────────────────────────────────────────


@router.post("/process/{repo_id}")
async def process_queue(
    repo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Process all pending sync actions for a repo (push to GitHub)."""
    gh = _gh(db, current_user)
    svc = SyncService(db)
    processed, succeeded, failed = await svc.process_queue(repo_id, gh)
    return {
        "processed": processed,
        "succeeded": succeeded,
        "failed": failed,
    }


# ── Pull ────────────────────────────────────────────────────────────


@router.post("/pull", response_model=PullResponse)
async def pull_updates(
    body: PullRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch updates from GitHub for a repo."""
    gh = _gh(db, current_user)
    svc = SyncService(db)
    data = await svc.pull_updates(body.repo_id, gh, body.from_oid)
    return PullResponse(
        repo_id=body.repo_id,
        up_to_date=data.get("up_to_date", False),
        from_oid=data.get("from_oid"),
        to_oid=data.get("to_oid"),
        files_changed=data.get("files_changed", 0),
        files=data.get("files", []),
        commits=data.get("commits", []),
    )


# ── Status & logs ──────────────────────────────────────────────────


@router.get("/status/{repo_id}", response_model=SyncStatusResponse)
async def queue_status(
    repo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = SyncService(db)
    status = await svc.get_queue_status(repo_id)
    return status


@router.get("/pending/{repo_id}", response_model=List[SyncActionResponse])
async def pending_actions(
    repo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = SyncService(db)
    return await svc.get_pending_actions(repo_id)


@router.get("/logs/{repo_id}", response_model=List[SyncLogResponse])
async def sync_logs(
    repo_id: str,
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = SyncService(db)
    return await svc.get_sync_logs(repo_id, limit)


# ── Retry / Cancel ─────────────────────────────────────────────────


@router.post("/retry/{repo_id}")
async def retry_failed(
    repo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = SyncService(db)
    count = await svc.retry_failed(repo_id)
    return {"reset_count": count}


@router.delete("/action/{action_id}")
async def cancel_action(
    action_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = SyncService(db)
    ok = await svc.cancel_action(action_id, current_user.id)
    if not ok:
        raise HTTPException(
            status_code=404, detail="Action not found or not cancellable"
        )
    return {"deleted": True}


# ── GitHub helpers ──────────────────────────────────────────────────


@router.get("/github/repos")
async def list_github_repos(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all repos on the user's GitHub account."""
    gh = _gh(db, current_user)
    return await gh.list_remote_repos()


@router.get("/github/branches/{repo_id}")
async def list_github_branches(
    repo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    gh = _gh(db, current_user)
    return await gh.get_remote_branches(repo_id)


@router.get("/github/tags/{repo_id}")
async def list_github_tags(
    repo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    gh = _gh(db, current_user)
    return await gh.get_remote_tags(repo_id)


@router.post("/github/create-repo")
async def create_github_repo(
    name: str,
    private: bool = True,
    description: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new repo on the user's GitHub account."""
    gh = _gh(db, current_user)
    return await gh.create_remote_repo(name, private, description)
