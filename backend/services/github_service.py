"""
GitHub integration service – proxies local git operations to GitHub REST/GraphQL API.
"""

from typing import Optional, List
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Repository, User

GITHUB_API = "https://api.github.com"


class GitHubService:
    """Wraps the GitHub REST API for repository sync operations."""

    def __init__(self, db: AsyncSession, user: User):
        self.db = db
        self.user = user
        self._token = user.github_token
        self._headers = {
            "Authorization": f"token {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    # ── Helpers ──────────────────────────────────────────────────────

    async def _get_repo(self, repo_id: str) -> Repository:
        result = await self.db.execute(
            select(Repository).where(
                Repository.id == repo_id,
                Repository.user_id == self.user.id,
            )
        )
        repo = result.scalar_one_or_none()
        if not repo:
            raise ValueError(f"Repository {repo_id} not found")
        return repo

    def _owner_repo(self, remote_url: str) -> str:
        """Extract 'owner/repo' from a GitHub URL."""
        url = remote_url.rstrip("/").removesuffix(".git")
        if "github.com" in url:
            parts = url.split("github.com")[-1].lstrip("/:")
            return parts
        raise ValueError(f"Cannot parse GitHub owner/repo from: {remote_url}")

    async def _api(
        self,
        method: str,
        path: str,
        json_body: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.request(
                method,
                f"{GITHUB_API}{path}",
                headers=self._headers,
                json=json_body,
                params=params,
            )
            if resp.status_code >= 400:
                detail = resp.text[:500]
                raise RuntimeError(
                    f"GitHub API {method} {path} → {resp.status_code}: {detail}"
                )
            if resp.status_code == 204:
                return {}
            return resp.json()

    # ── Push operations ─────────────────────────────────────────────

    async def push_commits(self, repo_id: str, payload: dict):
        """
        Push commits by creating/updating a git reference.
        payload: { branch, commits: [{ sha, tree_sha, message, parent_shas }] }
        For a hackathon demo this uses the Git Data API to create blobs/trees/commits.
        A production version would use the smart HTTP protocol.
        """
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        branch = payload.get("branch", repo.default_branch)

        # Get current HEAD of the branch on GitHub
        try:
            ref_data = await self._api(
                "GET", f"/repos/{owner_repo}/git/ref/heads/{branch}"
            )
            current_sha = ref_data["object"]["sha"]
        except RuntimeError:
            current_sha = None

        # For each commit, create it on GitHub (simplified — real impl would create full tree)
        new_sha = current_sha
        for commit_info in payload.get("commits", []):
            commit_body = {
                "message": commit_info["message"],
                "tree": commit_info.get("tree_sha", ""),
                "parents": commit_info.get("parent_shas", [new_sha] if new_sha else []),
            }
            result = await self._api(
                "POST", f"/repos/{owner_repo}/git/commits", commit_body
            )
            new_sha = result["sha"]

        # Update the branch reference
        if current_sha:
            await self._api(
                "PATCH",
                f"/repos/{owner_repo}/git/refs/heads/{branch}",
                {"sha": new_sha, "force": False},
            )
        else:
            await self._api(
                "POST",
                f"/repos/{owner_repo}/git/refs",
                {"ref": f"refs/heads/{branch}", "sha": new_sha},
            )

        # Bookmark
        repo.last_synced_oid = new_sha
        await self.db.commit()

    async def force_push(self, repo_id: str, payload: dict):
        """Force-update a branch ref."""
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        branch = payload["branch"]
        sha = payload["sha"]

        await self._api(
            "PATCH",
            f"/repos/{owner_repo}/git/refs/heads/{branch}",
            {"sha": sha, "force": True},
        )
        repo.last_synced_oid = sha
        await self.db.commit()

    # ── Branch operations ───────────────────────────────────────────

    async def create_branch(
        self, repo_id: str, branch_name: str, from_ref: str = "HEAD"
    ):
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)

        # Resolve from_ref to a SHA
        if from_ref == "HEAD":
            ref_data = await self._api(
                "GET", f"/repos/{owner_repo}/git/ref/heads/{repo.default_branch}"
            )
            sha = ref_data["object"]["sha"]
        elif len(from_ref) == 40:
            sha = from_ref
        else:
            ref_data = await self._api(
                "GET", f"/repos/{owner_repo}/git/ref/heads/{from_ref}"
            )
            sha = ref_data["object"]["sha"]

        await self._api(
            "POST",
            f"/repos/{owner_repo}/git/refs",
            {"ref": f"refs/heads/{branch_name}", "sha": sha},
        )

    async def delete_branch(self, repo_id: str, branch_name: str):
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        await self._api("DELETE", f"/repos/{owner_repo}/git/refs/heads/{branch_name}")

    async def rename_branch(self, repo_id: str, old_name: str, new_name: str):
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        await self._api(
            "POST",
            f"/repos/{owner_repo}/branches/{old_name}/rename",
            {"new_name": new_name},
        )

    # ── Tag operations ──────────────────────────────────────────────

    async def create_tag(
        self,
        repo_id: str,
        tag_name: str,
        ref: str = "HEAD",
        message: Optional[str] = None,
    ):
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)

        # Resolve ref
        if ref == "HEAD":
            ref_data = await self._api(
                "GET", f"/repos/{owner_repo}/git/ref/heads/{repo.default_branch}"
            )
            sha = ref_data["object"]["sha"]
        elif len(ref) == 40:
            sha = ref
        else:
            ref_data = await self._api(
                "GET", f"/repos/{owner_repo}/git/ref/heads/{ref}"
            )
            sha = ref_data["object"]["sha"]

        if message:
            # Annotated tag
            tag_obj = await self._api(
                "POST",
                f"/repos/{owner_repo}/git/tags",
                {
                    "tag": tag_name,
                    "message": message,
                    "object": sha,
                    "type": "commit",
                },
            )
            sha = tag_obj["sha"]

        await self._api(
            "POST",
            f"/repos/{owner_repo}/git/refs",
            {"ref": f"refs/tags/{tag_name}", "sha": sha},
        )

    async def delete_tag(self, repo_id: str, tag_name: str):
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        await self._api("DELETE", f"/repos/{owner_repo}/git/refs/tags/{tag_name}")

    # ── Merge ───────────────────────────────────────────────────────

    async def merge_branch(
        self, repo_id: str, base: str, head: str, message: Optional[str] = None
    ):
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        body: dict = {"base": base, "head": head}
        if message:
            body["commit_message"] = message
        result = await self._api("POST", f"/repos/{owner_repo}/merges", body)
        if result.get("sha"):
            repo.last_synced_oid = result["sha"]
            await self.db.commit()

    # ── Full / patch sync ───────────────────────────────────────────

    async def full_sync(self, repo_id: str, payload: dict):
        """
        Full repository sync — upload a bundle (base64 encoded git bundle or tar).
        For hackathon: we just push all refs and create a new commit with the full tree.
        """
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)

        # The payload should contain { bundle_b64, branch }
        # In production, decode the bundle and use git smart protocol.
        # For demo, we'll create tree + commit via blobs API if file_contents provided.
        files = payload.get("files", [])
        branch = payload.get("branch", repo.default_branch)

        if not files:
            return  # Nothing to sync

        # Create blobs
        tree_items = []
        for f in files:
            blob = await self._api(
                "POST",
                f"/repos/{owner_repo}/git/blobs",
                {"content": f["content"], "encoding": f.get("encoding", "utf-8")},
            )
            tree_items.append(
                {
                    "path": f["path"],
                    "mode": "100644",
                    "type": "blob",
                    "sha": blob["sha"],
                }
            )

        # Get current commit tree for the base
        try:
            ref_data = await self._api(
                "GET", f"/repos/{owner_repo}/git/ref/heads/{branch}"
            )
            base_sha = ref_data["object"]["sha"]
            commit_data = await self._api(
                "GET", f"/repos/{owner_repo}/git/commits/{base_sha}"
            )
            base_tree = commit_data["tree"]["sha"]
        except RuntimeError:
            base_tree = None
            base_sha = None

        # Create tree
        tree_body: dict = {"tree": tree_items}
        if base_tree:
            tree_body["base_tree"] = base_tree
        tree = await self._api("POST", f"/repos/{owner_repo}/git/trees", tree_body)

        # Create commit
        commit_body: dict = {
            "message": payload.get("message", "Sync from device"),
            "tree": tree["sha"],
        }
        if base_sha:
            commit_body["parents"] = [base_sha]
        commit = await self._api(
            "POST", f"/repos/{owner_repo}/git/commits", commit_body
        )

        # Update ref
        if base_sha:
            await self._api(
                "PATCH",
                f"/repos/{owner_repo}/git/refs/heads/{branch}",
                {"sha": commit["sha"], "force": False},
            )
        else:
            await self._api(
                "POST",
                f"/repos/{owner_repo}/git/refs",
                {"ref": f"refs/heads/{branch}", "sha": commit["sha"]},
            )

        repo.last_synced_oid = commit["sha"]
        await self.db.commit()

    async def patch_sync(self, repo_id: str, payload: dict):
        """
        Incremental patch sync — apply only changed files.
        payload: { branch, patches: [{ path, content, encoding?, deleted? }] }
        """
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        branch = payload.get("branch", repo.default_branch)
        patches = payload.get("patches", [])

        if not patches:
            return

        # Get current tree
        ref_data = await self._api("GET", f"/repos/{owner_repo}/git/ref/heads/{branch}")
        base_sha = ref_data["object"]["sha"]
        commit_data = await self._api(
            "GET", f"/repos/{owner_repo}/git/commits/{base_sha}"
        )
        base_tree_sha = commit_data["tree"]["sha"]

        tree_items = []
        for patch in patches:
            if patch.get("deleted"):
                # To delete: set sha to null (omit from new tree)
                tree_items.append(
                    {
                        "path": patch["path"],
                        "mode": "100644",
                        "type": "blob",
                        "sha": None,
                    }
                )
            else:
                blob = await self._api(
                    "POST",
                    f"/repos/{owner_repo}/git/blobs",
                    {
                        "content": patch["content"],
                        "encoding": patch.get("encoding", "utf-8"),
                    },
                )
                tree_items.append(
                    {
                        "path": patch["path"],
                        "mode": "100644",
                        "type": "blob",
                        "sha": blob["sha"],
                    }
                )

        new_tree = await self._api(
            "POST",
            f"/repos/{owner_repo}/git/trees",
            {"base_tree": base_tree_sha, "tree": tree_items},
        )

        commit = await self._api(
            "POST",
            f"/repos/{owner_repo}/git/commits",
            {
                "message": payload.get("message", "Patch sync from device"),
                "tree": new_tree["sha"],
                "parents": [base_sha],
            },
        )

        await self._api(
            "PATCH",
            f"/repos/{owner_repo}/git/refs/heads/{branch}",
            {"sha": commit["sha"], "force": False},
        )

        repo.last_synced_oid = commit["sha"]
        await self.db.commit()

    # ── Pull (remote → device) ──────────────────────────────────────

    async def pull_updates(self, repo_id: str, from_oid: Optional[str] = None) -> dict:
        """
        Fetch changes from GitHub since `from_oid`.
        Returns a dict with commits, changed files, and the new HEAD oid.
        """
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        branch = repo.default_branch

        # Current HEAD on remote
        ref_data = await self._api("GET", f"/repos/{owner_repo}/git/ref/heads/{branch}")
        remote_sha = ref_data["object"]["sha"]

        if from_oid and from_oid == remote_sha:
            return {"up_to_date": True, "to_oid": remote_sha, "files_changed": 0}

        # Get comparison
        if from_oid:
            try:
                compare = await self._api(
                    "GET", f"/repos/{owner_repo}/compare/{from_oid}...{remote_sha}"
                )
                files = [
                    {
                        "path": f["filename"],
                        "status": f["status"],
                        "patch": f.get("patch", ""),
                        "sha": f.get("sha"),
                    }
                    for f in compare.get("files", [])
                ]
                commits = [
                    {
                        "sha": c["sha"],
                        "message": c["commit"]["message"],
                        "author": c["commit"]["author"]["name"],
                        "date": c["commit"]["author"]["date"],
                    }
                    for c in compare.get("commits", [])
                ]
                return {
                    "up_to_date": False,
                    "from_oid": from_oid,
                    "to_oid": remote_sha,
                    "files_changed": len(files),
                    "files": files,
                    "commits": commits,
                    "summary": {
                        "ahead_by": compare.get("ahead_by", 0),
                        "behind_by": compare.get("behind_by", 0),
                    },
                }
            except RuntimeError:
                pass  # Fall through to full pull

        # Full pull — get the tree at HEAD
        commit_data = await self._api(
            "GET", f"/repos/{owner_repo}/git/commits/{remote_sha}"
        )
        tree_sha = commit_data["tree"]["sha"]
        tree = await self._api(
            "GET",
            f"/repos/{owner_repo}/git/trees/{tree_sha}",
            params={"recursive": "1"},
        )

        files = [
            {
                "path": item["path"],
                "sha": item["sha"],
                "type": item["type"],
                "mode": item["mode"],
            }
            for item in tree.get("tree", [])
            if item["type"] == "blob"
        ]

        return {
            "up_to_date": False,
            "full_pull": True,
            "to_oid": remote_sha,
            "files_changed": len(files),
            "files": files,
            "summary": {},
        }

    # ── Repository management on GitHub ─────────────────────────────

    async def create_remote_repo(
        self, name: str, private: bool = True, description: str = ""
    ) -> dict:
        """Create a new repository on GitHub for the authenticated user."""
        return await self._api(
            "POST",
            "/user/repos",
            {
                "name": name,
                "private": private,
                "description": description,
                "auto_init": False,
            },
        )

    async def delete_remote_repo(self, repo_id: str):
        """Delete a repository from GitHub."""
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        await self._api("DELETE", f"/repos/{owner_repo}")

    async def list_remote_repos(self) -> List[dict]:
        """List all repos visible to the authenticated user."""
        repos = await self._api(
            "GET", "/user/repos", params={"per_page": "100", "sort": "updated"}
        )
        return (
            [
                {
                    "name": r["name"],
                    "full_name": r["full_name"],
                    "private": r["private"],
                    "html_url": r["html_url"],
                    "clone_url": r["clone_url"],
                    "default_branch": r.get("default_branch", "main"),
                    "updated_at": r["updated_at"],
                }
                for r in repos
            ]
            if isinstance(repos, list)
            else []
        )

    async def get_remote_branches(self, repo_id: str) -> List[dict]:
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        branches = await self._api(
            "GET", f"/repos/{owner_repo}/branches", params={"per_page": "100"}
        )
        return (
            [
                {
                    "name": b["name"],
                    "sha": b["commit"]["sha"],
                    "protected": b.get("protected", False),
                }
                for b in branches
            ]
            if isinstance(branches, list)
            else []
        )

    async def get_remote_tags(self, repo_id: str) -> List[dict]:
        repo = await self._get_repo(repo_id)
        owner_repo = self._owner_repo(repo.remote_url)
        tags = await self._api(
            "GET", f"/repos/{owner_repo}/tags", params={"per_page": "100"}
        )
        return (
            [{"name": t["name"], "sha": t["commit"]["sha"]} for t in tags]
            if isinstance(tags, list)
            else []
        )
