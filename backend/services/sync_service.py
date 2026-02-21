"""
Sync service – processes queued actions, handles ordering, retries & conflicts.
"""

import json
import traceback
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    SyncAction,
    SyncLog,
    Repository,
    SyncActionType,
    SyncStatus,
    SyncDirection,
)
from services.github_service import GitHubService


class SyncService:
    """Processes the offline-first sync queue."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Queue ingestion ─────────────────────────────────────────────

    async def enqueue(
        self,
        user_id: str,
        repo_id: str,
        action_type: SyncActionType,
        payload: dict,
        sequence: Optional[int] = None,
    ) -> SyncAction:
        """Add a single action to the queue."""
        if sequence is None:
            # auto-increment per repo
            result = await self.db.execute(
                select(SyncAction.sequence)
                .where(SyncAction.repo_id == repo_id)
                .order_by(SyncAction.sequence.desc())
                .limit(1)
            )
            last_seq = result.scalar_one_or_none() or 0
            sequence = last_seq + 1

        action = SyncAction(
            user_id=user_id,
            repo_id=repo_id,
            action_type=action_type,
            payload=payload,
            status=SyncStatus.pending,
            sequence=sequence,
        )
        self.db.add(action)
        await self.db.commit()
        await self.db.refresh(action)
        return action

    async def enqueue_batch(
        self,
        user_id: str,
        repo_id: str,
        actions: List[dict],
    ) -> List[SyncAction]:
        """Add multiple ordered actions at once."""
        result = await self.db.execute(
            select(SyncAction.sequence)
            .where(SyncAction.repo_id == repo_id)
            .order_by(SyncAction.sequence.desc())
            .limit(1)
        )
        last_seq = result.scalar_one_or_none() or 0

        created = []
        for i, a in enumerate(actions):
            action = SyncAction(
                user_id=user_id,
                repo_id=repo_id,
                action_type=SyncActionType(a["action_type"]),
                payload=a.get("payload", {}),
                status=SyncStatus.PENDING,
                sequence=last_seq + i + 1,
            )
            self.db.add(action)
            created.append(action)

        await self.db.commit()
        for c in created:
            await self.db.refresh(c)
        return created

    # ── Queue processing ────────────────────────────────────────────

    async def process_queue(
        self,
        repo_id: str,
        github_service: GitHubService,
    ) -> Tuple[int, int, int]:
        """
        Process all pending actions for a repo in sequence order.
        Returns (processed, succeeded, failed).
        """
        result = await self.db.execute(
            select(SyncAction)
            .where(
                SyncAction.repo_id == repo_id,
                SyncAction.status.in_([SyncStatus.PENDING, SyncStatus.FAILED]),
            )
            .order_by(SyncAction.sequence)
        )
        actions = result.scalars().all()

        processed = 0
        succeeded = 0
        failed = 0

        for action in actions:
            # Skip if retries exhausted
            if (
                action.status == SyncStatus.FAILED
                and action.retry_count >= action.max_retries
            ):
                continue

            action.status = SyncStatus.PROCESSING
            await self.db.commit()
            processed += 1

            try:
                await self._execute_action(action, github_service)
                action.status = SyncStatus.COMPLETED
                action.synced_at = datetime.now(timezone.utc)
                succeeded += 1

                # Log success
                await self._log(
                    repo_id=repo_id,
                    action_id=action.id,
                    direction=SyncDirection.PUSH,
                    status="success",
                    details={"action_type": action.action_type.value},
                )
            except Exception as e:
                action.status = SyncStatus.FAILED
                action.error_message = str(e)
                action.retry_count += 1
                failed += 1

                await self._log(
                    repo_id=repo_id,
                    action_id=action.id,
                    direction=SyncDirection.PUSH,
                    status="error",
                    details={
                        "action_type": action.action_type.value,
                        "error": str(e),
                        "traceback": traceback.format_exc(),
                    },
                )

                # Stop processing on conflict — needs manual resolution
                if "conflict" in str(e).lower():
                    action.status = SyncStatus.CONFLICT
                    await self.db.commit()
                    break

            await self.db.commit()

        return processed, succeeded, failed

    async def _execute_action(self, action: SyncAction, gh: GitHubService):
        """Dispatch a single action to the GitHub service."""
        t = action.action_type
        p = action.payload or {}

        if t == SyncActionType.PUSH_COMMITS:
            await gh.push_commits(action.repo_id, p)
        elif t == SyncActionType.CREATE_BRANCH:
            await gh.create_branch(
                action.repo_id, p["branch_name"], p.get("from_ref", "HEAD")
            )
        elif t == SyncActionType.DELETE_BRANCH:
            await gh.delete_branch(action.repo_id, p["branch_name"])
        elif t == SyncActionType.RENAME_BRANCH:
            await gh.rename_branch(action.repo_id, p["old_name"], p["new_name"])
        elif t == SyncActionType.CREATE_TAG:
            await gh.create_tag(
                action.repo_id, p["tag_name"], p.get("ref", "HEAD"), p.get("message")
            )
        elif t == SyncActionType.DELETE_TAG:
            await gh.delete_tag(action.repo_id, p["tag_name"])
        elif t == SyncActionType.MERGE_BRANCH:
            await gh.merge_branch(
                action.repo_id, p["base"], p["head"], p.get("message")
            )
        elif t == SyncActionType.FORCE_PUSH:
            await gh.force_push(action.repo_id, p)
        elif t == SyncActionType.FULL_SYNC:
            await gh.full_sync(action.repo_id, p)
        elif t == SyncActionType.PATCH_SYNC:
            await gh.patch_sync(action.repo_id, p)
        else:
            raise ValueError(f"Unknown action type: {t}")

    # ── Pull (remote → device) ──────────────────────────────────────

    async def pull_updates(
        self,
        repo_id: str,
        github_service: GitHubService,
        from_oid: Optional[str] = None,
    ) -> dict:
        """
        Fetch latest state from GitHub for a repo.
        Returns a payload the device can apply locally.
        """
        # Get the repo record so we know the remote URL / last synced OID
        result = await self.db.execute(
            select(Repository).where(Repository.id == repo_id)
        )
        repo = result.scalar_one_or_none()
        if not repo:
            raise ValueError("Repository not found")

        effective_from = from_oid or repo.last_synced_oid

        pull_data = await github_service.pull_updates(repo_id, effective_from)

        # Update the bookmark
        if pull_data.get("to_oid"):
            repo.last_synced_oid = pull_data["to_oid"]
            repo.last_synced_at = datetime.now(timezone.utc)
            await self.db.commit()

        # Log pull
        await self._log(
            repo_id=repo_id,
            action_id=None,
            direction=SyncDirection.PULL,
            status="success",
            from_oid=effective_from,
            to_oid=pull_data.get("to_oid"),
            files_changed=pull_data.get("files_changed", 0),
            details=pull_data.get("summary", {}),
        )

        return pull_data

    # ── Status helpers ──────────────────────────────────────────────

    async def get_queue_status(self, repo_id: str) -> dict:
        """Return counts by status for a repo's queue."""
        result = await self.db.execute(
            select(SyncAction).where(SyncAction.repo_id == repo_id)
        )
        actions = result.scalars().all()
        counts = {
            "pending": 0,
            "processing": 0,
            "completed": 0,
            "failed": 0,
            "conflict": 0,
        }
        for a in actions:
            counts[a.status.value] = counts.get(a.status.value, 0) + 1
        return {
            "repo_id": repo_id,
            "total": len(actions),
            **counts,
        }

    async def get_pending_actions(self, repo_id: str) -> List[SyncAction]:
        result = await self.db.execute(
            select(SyncAction)
            .where(
                SyncAction.repo_id == repo_id,
                SyncAction.status == SyncStatus.PENDING,
            )
            .order_by(SyncAction.sequence)
        )
        return result.scalars().all()

    async def get_sync_logs(self, repo_id: str, limit: int = 50) -> List[SyncLog]:
        result = await self.db.execute(
            select(SyncLog)
            .where(SyncLog.repo_id == repo_id)
            .order_by(SyncLog.timestamp.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def retry_failed(self, repo_id: str) -> int:
        """Reset all failed (non-exhausted) actions back to pending."""
        result = await self.db.execute(
            update(SyncAction)
            .where(
                SyncAction.repo_id == repo_id,
                SyncAction.status == SyncStatus.FAILED,
                SyncAction.retry_count < SyncAction.max_retries,
            )
            .values(status=SyncStatus.PENDING, error_message=None)
        )
        await self.db.commit()
        return result.rowcount  # type: ignore

    async def cancel_action(self, action_id: str, user_id: str) -> bool:
        """Cancel a pending/failed action."""
        result = await self.db.execute(
            select(SyncAction).where(
                SyncAction.id == action_id,
                SyncAction.user_id == user_id,
                SyncAction.status.in_(
                    [SyncStatus.PENDING, SyncStatus.FAILED, SyncStatus.CONFLICT]
                ),
            )
        )
        action = result.scalar_one_or_none()
        if not action:
            return False
        await self.db.delete(action)
        await self.db.commit()
        return True

    # ── Internal ────────────────────────────────────────────────────

    async def _log(
        self,
        repo_id: str,
        action_id: Optional[str],
        direction: SyncDirection,
        status: str,
        from_oid: Optional[str] = None,
        to_oid: Optional[str] = None,
        files_changed: int = 0,
        details: Optional[dict] = None,
    ):
        log = SyncLog(
            repo_id=repo_id,
            action_id=action_id,
            direction=direction,
            status=status,
            from_oid=from_oid,
            to_oid=to_oid,
            files_changed=files_changed,
            details=details or {},
        )
        self.db.add(log)
        await self.db.commit()
