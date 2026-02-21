import * as git from 'isomorphic-git'
import { fs } from '../utils/fsAdapter'
import { createRepoFolder, getRepoPath } from './repoService'
import * as FileSystem from 'expo-file-system/legacy'
import { http, getOnAuth } from './githubAuth'

// =====================================================================
//  CONFIG
// =====================================================================

let _author = { name: 'User', email: 'user@example.com' }

/** Update the global author used for commits / merges. */
export function setAuthor(name, email) {
  _author = { name, email }
}

export function getAuthor() {
  return { ..._author }
}

// =====================================================================
//  INIT / CLONE
// =====================================================================

export async function initRepo(repoName) {
  const dir = await createRepoFolder(repoName)
  await git.init({ fs, dir, defaultBranch: 'main' })
  return dir
}

/**
 * Clone from a remote URL (when online) OR from another local repo path.
 * Supports http/https and local file:// / bare paths.
 */
export async function cloneRepo(url, repoName, options = {}) {
  const dir = await createRepoFolder(repoName)
  await git.clone({
    fs,
    dir,
    url,
    singleBranch: options.singleBranch ?? false,
    depth: options.depth ?? undefined,
    noCheckout: options.noCheckout ?? false,
    http: options.http, // pass http plugin when cloning over network
    onProgress: options.onProgress,
    onAuth: options.onAuth,
  })
  return dir
}

/**
 * Import / duplicate a local repo into a new one (offline copy).
 */
export async function duplicateRepo(sourceRepoName, newRepoName) {
  const src = getRepoPath(sourceRepoName)
  const dest = await createRepoFolder(newRepoName)
  await copyDirectory(src, dest)
  return dest
}

// =====================================================================
//  STAGING
// =====================================================================

/** Stage a single file (add to index). */
export async function stageFile(repoName, filepath) {
  const dir = getRepoPath(repoName)
  await git.add({ fs, dir, filepath })
}

/** Unstage a single file (remove from index, keep working copy). */
export async function unstageFile(repoName, filepath) {
  const dir = getRepoPath(repoName)
  await git.remove({ fs, dir, filepath })
}

/** Stage all changed / new / deleted files by comparing working dir to HEAD. */
export async function stageAll(repoName) {
  const dir = getRepoPath(repoName)
  const statusMatrix = await git.statusMatrix({ fs, dir })

  for (const [
    filepath,
    headStatus,
    workdirStatus,
    stageStatus,
  ] of statusMatrix) {
    if (workdirStatus === 0) {
      // File deleted in workdir → remove from index
      await git.remove({ fs, dir, filepath })
    } else if (headStatus !== workdirStatus || stageStatus !== workdirStatus) {
      await git.add({ fs, dir, filepath })
    }
  }
}

// =====================================================================
//  STATUS
// =====================================================================

/**
 * Returns an array of { filepath, status } objects.
 * status values: 'unmodified' | 'modified' | 'added' | 'deleted' | 'untracked' | 'absent' | '*modified' | '*added' | '*deleted'
 *
 * The asterisk (*) prefix means the change is staged.
 */
export async function getStatus(repoName) {
  const dir = getRepoPath(repoName)
  const matrix = await git.statusMatrix({ fs, dir })

  return matrix.map(([filepath, head, workdir, stage]) => {
    const status = statusFromMatrix(head, workdir, stage)
    return { filepath, head, workdir, stage, status }
  })
}

/** Get status of a single file. */
export async function getFileStatus(repoName, filepath) {
  const dir = getRepoPath(repoName)
  const status = await git.status({ fs, dir, filepath })
  return status // e.g. 'modified', '*added', 'absent', etc.
}

function statusFromMatrix(head, workdir, stage) {
  // [H, W, S] – see isomorphic-git docs: statusMatrix
  if (head === 0 && workdir === 0 && stage === 0) return 'unmodified' // absent everywhere
  if (head === 0 && workdir === 0 && stage === 3) return '*added' // staged but deleted from workdir
  if (head === 0 && workdir === 2 && stage === 0) return 'untracked'
  if (head === 0 && workdir === 2 && stage === 2) return '*added'
  if (head === 0 && workdir === 2 && stage === 3) return '*added' // added + modified
  if (head === 1 && workdir === 1 && stage === 1) return 'unmodified'
  if (head === 1 && workdir === 1 && stage === 0) return 'modified' // index cleared – workdir still matches HEAD content
  if (head === 1 && workdir === 1 && stage === 3) return 'modified' // index stale after checkout – workdir matches HEAD
  if (head === 1 && workdir === 2 && stage === 1) return 'modified'
  if (head === 1 && workdir === 2 && stage === 2) return '*modified'
  if (head === 1 && workdir === 2 && stage === 3) return '*modified' // staged + further edits
  if (head === 1 && workdir === 0 && stage === 1) return 'deleted'
  if (head === 1 && workdir === 0 && stage === 0) return '*deleted'
  if (head === 1 && workdir === 0 && stage === 3) return '*deleted' // edge
  return 'unknown'
}

// =====================================================================
//  COMMIT
// =====================================================================

/** Commit currently staged files. */
export async function commit(repoName, message, options = {}) {
  const dir = getRepoPath(repoName)
  const sha = await git.commit({
    fs,
    dir,
    message,
    author: options.author ?? _author,
    committer: options.committer ?? _author,
    parent: options.parent,
  })
  return sha
}

/** Stage everything and commit in one step. */
export async function commitAll(repoName, message, options = {}) {
  await stageAll(repoName)
  return commit(repoName, message, options)
}

// =====================================================================
//  BRANCHES
// =====================================================================

/** Create a new branch (does not check it out). */
export async function createBranch(repoName, branch, options = {}) {
  const dir = getRepoPath(repoName)
  await git.branch({
    fs,
    dir,
    ref: branch,
    checkout: options.checkout ?? false,
    object: options.startPoint, // commit/branch to start from
  })
}

/** Delete a branch. */
export async function deleteBranch(repoName, branch) {
  const dir = getRepoPath(repoName)
  await git.deleteBranch({ fs, dir, ref: branch })
}

/** Rename a branch. */
export async function renameBranch(repoName, oldName, newName) {
  const dir = getRepoPath(repoName)
  await git.renameBranch({ fs, dir, ref: newName, oldref: oldName })
}

/** List all local branches. */
export async function listBranches(repoName) {
  const dir = getRepoPath(repoName)
  return git.listBranches({ fs, dir })
}

/** Get the current branch name (null if detached HEAD). */
export async function currentBranch(repoName) {
  const dir = getRepoPath(repoName)
  return git.currentBranch({ fs, dir, fullname: false })
}

/** Checkout a branch or commit. */
export async function checkout(repoName, ref, options = {}) {
  const dir = getRepoPath(repoName)
  await git.checkout({
    fs,
    dir,
    ref,
    force: options.force ?? true,
    filepaths: options.filepaths,
  })
}

// =====================================================================
//  TAGS
// =====================================================================

/** Create a lightweight tag. */
export async function createTag(repoName, tag, options = {}) {
  const dir = getRepoPath(repoName)
  await git.tag({
    fs,
    dir,
    ref: tag,
    object: options.object, // oid to tag (defaults to HEAD)
    force: options.force ?? false,
  })
}

/** Delete a tag. */
export async function deleteTag(repoName, tag) {
  const dir = getRepoPath(repoName)
  await git.deleteTag({ fs, dir, ref: tag })
}

/** List all tags. */
export async function listTags(repoName) {
  const dir = getRepoPath(repoName)
  return git.listTags({ fs, dir })
}

// =====================================================================
//  MERGE  (with conflict detection)
// =====================================================================

/**
 * Merge `theirBranch` into the current branch.
 *
 * Returns { oid, alreadyMerged, fastForward, conflicts }
 *  - conflicts is null when merge succeeds
 *  - conflicts is an array of filepaths when there are conflicts
 */
export async function mergeBranch(repoName, theirBranch, options = {}) {
  const dir = getRepoPath(repoName)

  try {
    const result = await git.merge({
      fs,
      dir,
      theirs: theirBranch,
      author: options.author ?? _author,
      fastForward: options.fastForwardOnly ? true : undefined,
      fastForwardOnly: options.fastForwardOnly ?? false,
      dryRun: options.dryRun ?? false,
      noUpdateBranch: options.noUpdateBranch ?? false,
      abortOnConflict: options.abortOnConflict ?? true,
    })

    if (!options.dryRun && !options.noUpdateBranch) {
      await git.checkout({ fs, dir, ref: await currentBranch(repoName) })
    }

    return { ...result, conflicts: null }
  } catch (err) {
    if (
      err.code === 'MergeConflictError' ||
      err.code === 'MergeNotSupportedError'
    ) {
      // Collect conflicted filepaths
      const conflicts = await detectConflicts(repoName, theirBranch)
      return { oid: null, conflicts }
    }
    throw err
  }
}

/**
 * Detect which files conflict between current branch and `theirBranch`.
 */
export async function detectConflicts(repoName, theirBranch) {
  const dir = getRepoPath(repoName)
  const ourBranch = await currentBranch(repoName)

  const ourCommit = await git.resolveRef({ fs, dir, ref: ourBranch })
  const theirCommit = await git.resolveRef({ fs, dir, ref: theirBranch })

  // find merge base
  const [baseOid] = await git.findMergeBase({
    fs,
    dir,
    oids: [ourCommit, theirCommit],
  })

  const baseTree = baseOid ? await readTreeFlat(dir, baseOid) : {}
  const ourTree = await readTreeFlat(dir, ourCommit)
  const theirTree = await readTreeFlat(dir, theirCommit)

  const allFiles = new Set([
    ...Object.keys(baseTree),
    ...Object.keys(ourTree),
    ...Object.keys(theirTree),
  ])
  const conflicts = []

  for (const filepath of allFiles) {
    const base = baseTree[filepath] ?? null
    const ours = ourTree[filepath] ?? null
    const theirs = theirTree[filepath] ?? null
    if (ours !== theirs && ours !== base && theirs !== base) {
      conflicts.push(filepath)
    }
  }
  return conflicts
}

/**
 * Read the entire tree of a commit into a flat { filepath: oid } map.
 */
async function readTreeFlat(dir, commitOid) {
  const map = {}
  const commit = await git.readCommit({ fs, dir, oid: commitOid })
  const treeOid = commit.commit.tree

  async function walk(treeOid, prefix) {
    const { tree } = await git.readTree({ fs, dir, oid: treeOid })
    for (const entry of tree) {
      const fullpath = prefix ? `${prefix}/${entry.path}` : entry.path
      if (entry.type === 'blob') {
        map[fullpath] = entry.oid
      } else if (entry.type === 'tree') {
        await walk(entry.oid, fullpath)
      }
    }
  }
  await walk(treeOid, '')
  return map
}

/**
 * Get the three-way diff for a conflicted file (base, ours, theirs).
 * Returns { base, ours, theirs } as strings (null if file doesn't exist in that version).
 */
export async function getConflictVersions(repoName, filepath, theirBranch) {
  const dir = getRepoPath(repoName)
  const ourBranch = await currentBranch(repoName)

  const ourCommit = await git.resolveRef({ fs, dir, ref: ourBranch })
  const theirCommit = await git.resolveRef({ fs, dir, ref: theirBranch })
  const [baseOid] = await git.findMergeBase({
    fs,
    dir,
    oids: [ourCommit, theirCommit],
  })

  async function readBlob(commitOid, fp) {
    try {
      const { blob } = await git.readBlob({
        fs,
        dir,
        oid: commitOid,
        filepath: fp,
      })
      return new TextDecoder().decode(blob)
    } catch {
      return null
    }
  }

  return {
    base: baseOid ? await readBlob(baseOid, filepath) : null,
    ours: await readBlob(ourCommit, filepath),
    theirs: await readBlob(theirCommit, filepath),
  }
}

/**
 * Resolve a conflict for a single file by writing the resolved content,
 * staging it, and returning the path.
 */
export async function resolveConflict(repoName, filepath, resolvedContent) {
  const dir = getRepoPath(repoName)
  const fullPath = `${dir}/${filepath}`
  await fs.promises.writeFile(fullPath, resolvedContent, 'utf8')
  await git.add({ fs, dir, filepath })
  return filepath
}

// =====================================================================
//  LOG / HISTORY
// =====================================================================

/** Full commit log (optionally limited). */
export async function getLog(repoName, options = {}) {
  const dir = getRepoPath(repoName)
  return git.log({
    fs,
    dir,
    depth: options.depth,
    ref: options.ref ?? 'HEAD',
  })
}

/** Read a single commit by oid. */
export async function readCommit(repoName, oid) {
  const dir = getRepoPath(repoName)
  return git.readCommit({ fs, dir, oid })
}

/** Resolve a ref (branch name, tag, HEAD) to an oid. */
export async function resolveRef(repoName, ref) {
  const dir = getRepoPath(repoName)
  return git.resolveRef({ fs, dir, ref })
}

/** Find merge base(s) between two oids/refs. */
export async function findMergeBase(repoName, refA, refB) {
  const dir = getRepoPath(repoName)
  const oidA = await git.resolveRef({ fs, dir, ref: refA })
  const oidB = await git.resolveRef({ fs, dir, ref: refB })
  return git.findMergeBase({ fs, dir, oids: [oidA, oidB] })
}

// =====================================================================
//  DIFF
// =====================================================================

/**
 * Get the diff of a file between two refs (or HEAD vs working dir).
 * Returns { oldContent, newContent } as strings.
 */
export async function diffFile(repoName, filepath, refA = 'HEAD', refB = null) {
  const dir = getRepoPath(repoName)

  let oldContent = null
  try {
    const commitOid = await git.resolveRef({ fs, dir, ref: refA })
    const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath })
    oldContent = new TextDecoder().decode(blob)
  } catch {
    oldContent = null
  }

  let newContent = null
  if (refB === null) {
    // Compare against working directory
    const fullPath = `${dir}/${filepath}`
    try {
      newContent = await fs.promises.readFile(fullPath, 'utf8')
    } catch {
      newContent = null
    }
  } else {
    try {
      const commitOid = await git.resolveRef({ fs, dir, ref: refB })
      const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath })
      newContent = new TextDecoder().decode(blob)
    } catch {
      newContent = null
    }
  }

  return { oldContent, newContent }
}

/**
 * List files changed in a commit (compares the commit's tree against its
 * parent's tree).  When called with only one ref it defaults to that
 * behaviour.  Returns [{ filepath, type }] where type is 'added',
 * 'deleted' or 'modified'.
 */
export async function diffSummary(repoName, refA = 'HEAD', refB = null) {
  const dir = getRepoPath(repoName)

  // Resolve the oid for refA
  const oidA = await git.resolveRef({ fs, dir, ref: refA }).catch(() => refA)
  const commitA = await git.readCommit({ fs, dir, oid: oidA })

  let parentTree = {}
  if (refB) {
    // Explicit second ref – compare two commits
    const oidB = await git.resolveRef({ fs, dir, ref: refB }).catch(() => refB)
    parentTree = await readTreeFlat(dir, oidB)
  } else if (commitA.commit.parent.length > 0) {
    // Compare commit against its first parent
    parentTree = await readTreeFlat(dir, commitA.commit.parent[0])
  }
  // else: initial commit – parentTree stays empty → everything is 'added'

  const commitTree = await readTreeFlat(dir, oidA)

  const allPaths = new Set([
    ...Object.keys(parentTree),
    ...Object.keys(commitTree),
  ])
  const changes = []

  for (const filepath of allPaths) {
    const inParent = parentTree[filepath] ?? null
    const inCommit = commitTree[filepath] ?? null

    if (inParent === inCommit) continue // unchanged

    let type = 'modified'
    if (!inParent) type = 'added'
    else if (!inCommit) type = 'deleted'

    changes.push({ filepath, type })
  }
  return changes
}

// =====================================================================
//  REFLOG / RECOVERY
// =====================================================================

/**
 * Simple reflog implementation stored as JSON in .git/reflog.json.
 * isomorphic-git doesn't have native reflog, so we maintain our own.
 */
const REFLOG_FILE = 'reflog.json'

async function getReflogPath(repoName) {
  const dir = getRepoPath(repoName)
  return `${dir}/.git/${REFLOG_FILE}`
}

export async function appendReflog(repoName, entry) {
  const path = await getReflogPath(repoName)
  let entries = []
  try {
    const raw = await fs.promises.readFile(path, 'utf8')
    entries = JSON.parse(raw)
  } catch {
    entries = []
  }
  entries.push({
    ...entry,
    timestamp: Date.now(),
  })
  await fs.promises.writeFile(path, JSON.stringify(entries, null, 2), 'utf8')
}

export async function getReflog(repoName) {
  const path = await getReflogPath(repoName)
  try {
    const raw = await fs.promises.readFile(path, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

/**
 * Wraps commit to also record reflog entry.
 */
export async function commitWithReflog(repoName, message, options = {}) {
  const beforeOid = await resolveRef(repoName, 'HEAD').catch(() => null)
  const sha = await commit(repoName, message, options)
  await appendReflog(repoName, {
    action: 'commit',
    message,
    from: beforeOid,
    to: sha,
    branch: await currentBranch(repoName),
  })
  return sha
}

/** Recover to a specific oid (like git reset --hard <oid>). */
export async function resetHard(repoName, oid) {
  const dir = getRepoPath(repoName)
  const branch = await currentBranch(repoName)

  // Point branch to the target commit
  await fs.promises.writeFile(
    `${dir}/.git/refs/heads/${branch}`,
    oid + '\n',
    'utf8',
  )

  // Check out the files
  await git.checkout({ fs, dir, ref: branch, force: true })

  await appendReflog(repoName, {
    action: 'reset',
    to: oid,
    branch,
  })
}

// =====================================================================
//  CHERRY-PICK / REBASE
// =====================================================================

/**
 * Cherry-pick: apply the changes from a single commit onto the current HEAD.
 * Reads the diff between the commit and its parent, then applies those changes.
 */
export async function cherryPick(repoName, commitOid) {
  const dir = getRepoPath(repoName)

  const { commit: commitObj } = await git.readCommit({
    fs,
    dir,
    oid: commitOid,
  })
  const parentOid = commitObj.parent[0] // first parent
  if (!parentOid) throw new Error('Cannot cherry-pick a root commit')

  const parentTree = await readTreeFlat(dir, parentOid)
  const commitTree = await readTreeFlat(dir, commitOid)

  // Find changes in this commit vs its parent
  const allFiles = new Set([
    ...Object.keys(parentTree),
    ...Object.keys(commitTree),
  ])

  for (const filepath of allFiles) {
    const oldOid = parentTree[filepath] ?? null
    const newOid = commitTree[filepath] ?? null

    if (oldOid === newOid) continue // unchanged

    if (newOid === null) {
      // File deleted in this commit
      const fullPath = `${dir}/${filepath}`
      try {
        await fs.promises.unlink(fullPath)
      } catch {
        /* already gone */
      }
      try {
        await git.remove({ fs, dir, filepath })
      } catch {
        /* ok */
      }
    } else {
      // File added or modified – write the new content
      const { blob } = await git.readBlob({ fs, dir, oid: newOid })
      const content = new TextDecoder().decode(blob)
      const fullPath = `${dir}/${filepath}`
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      try {
        await fs.promises.mkdir(parentDir, { recursive: true })
      } catch {
        /* exists */
      }
      await fs.promises.writeFile(fullPath, content, 'utf8')
      await git.add({ fs, dir, filepath })
    }
  }

  // Create the new commit with the original message
  const sha = await git.commit({
    fs,
    dir,
    message: commitObj.message,
    author: _author,
    committer: _author,
  })

  return sha
}

/**
 * Rebase current branch onto a target branch.
 * Replays commits from the current branch that are not in the target.
 *
 * Steps:
 * 1. Find merge base between current and target
 * 2. Collect commits on current branch since merge base
 * 3. Reset current branch to target's HEAD
 * 4. Cherry-pick each commit in order
 *
 * Returns { success, replayedCommits, newHead }
 */
export async function rebase(repoName, ontoBranch) {
  const dir = getRepoPath(repoName)
  const ourBranch = await currentBranch(repoName)

  if (!ourBranch) throw new Error('Cannot rebase in detached HEAD state')
  if (ourBranch === ontoBranch)
    throw new Error('Cannot rebase onto the same branch')

  const ourHead = await git.resolveRef({ fs, dir, ref: ourBranch })
  const theirHead = await git.resolveRef({ fs, dir, ref: ontoBranch })

  // Find merge base
  const [baseOid] = await git.findMergeBase({
    fs,
    dir,
    oids: [ourHead, theirHead],
  })
  if (!baseOid) throw new Error('No common ancestor found')

  // Collect our commits since the merge base (oldest first)
  const allLog = await git.log({ fs, dir, ref: ourBranch, depth: 500 })
  const toReplay = []
  for (const entry of allLog) {
    if (entry.oid === baseOid) break
    toReplay.push(entry)
  }
  toReplay.reverse() // oldest first

  if (toReplay.length === 0) {
    // Already up to date – just fast-forward
    await fs.promises.writeFile(
      `${dir}/.git/refs/heads/${ourBranch}`,
      theirHead + '\n',
      'utf8',
    )
    await git.checkout({ fs, dir, ref: ourBranch, force: true })
    return { success: true, replayedCommits: 0, newHead: theirHead }
  }

  // Reset our branch to target's HEAD
  await fs.promises.writeFile(
    `${dir}/.git/refs/heads/${ourBranch}`,
    theirHead + '\n',
    'utf8',
  )
  await git.checkout({ fs, dir, ref: ourBranch, force: true })

  // Cherry-pick each commit
  let newHead = theirHead
  const replayed = []
  for (const entry of toReplay) {
    try {
      newHead = await cherryPick(repoName, entry.oid)
      replayed.push({
        oldOid: entry.oid,
        newOid: newHead,
        message: entry.commit.message,
      })
    } catch (err) {
      // On failure, record what we managed and report
      await appendReflog(repoName, {
        action: 'rebase',
        message: `rebase ${ourBranch} onto ${ontoBranch} (partial: ${replayed.length}/${toReplay.length})`,
        from: ourHead,
        to: newHead,
        branch: ourBranch,
      })
      throw new Error(
        `Rebase stopped at "${entry.commit.message.trim()}" (${entry.oid.slice(0, 7)}): ${err.message}. ` +
          `${replayed.length} of ${toReplay.length} commits replayed.`,
      )
    }
  }

  await appendReflog(repoName, {
    action: 'rebase',
    message: `rebase ${ourBranch} onto ${ontoBranch}`,
    from: ourHead,
    to: newHead,
    branch: ourBranch,
  })

  return { success: true, replayedCommits: replayed.length, newHead }
}

// =====================================================================
//  READ BLOB / TREE helpers (for code exploration)
// =====================================================================

/** Read a blob (file content) by oid. */
export async function readBlob(repoName, oid) {
  const dir = getRepoPath(repoName)
  const { blob } = await git.readBlob({ fs, dir, oid })
  return new TextDecoder().decode(blob)
}

/** Read a file at a specific ref. */
export async function readFileAtRef(repoName, filepath, ref = 'HEAD') {
  const dir = getRepoPath(repoName)
  const commitOid = await git.resolveRef({ fs, dir, ref })
  const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath })
  return new TextDecoder().decode(blob)
}

/** List files in the repository tree at a specific ref. */
export async function listFilesAtRef(repoName, ref = 'HEAD') {
  const dir = getRepoPath(repoName)
  return git.listFiles({ fs, dir, ref })
}

// =====================================================================
//  REPO HEALTH / INTEGRITY
// =====================================================================

/**
 * Basic repository health check:
 *  - Validates HEAD points to a valid ref
 *  - Checks that the objects directory exists
 *  - Verifies current branch is resolvable
 */
export async function checkRepoHealth(repoName) {
  const dir = getRepoPath(repoName)
  const issues = []

  try {
    await git.resolveRef({ fs, dir, ref: 'HEAD' })
  } catch {
    issues.push('HEAD does not resolve to a valid commit')
  }

  const objectsDir = `${dir}/.git/objects`
  try {
    await fs.promises.stat(objectsDir)
  } catch {
    issues.push('.git/objects directory is missing')
  }

  const refsDir = `${dir}/.git/refs`
  try {
    await fs.promises.stat(refsDir)
  } catch {
    issues.push('.git/refs directory is missing')
  }

  const branch = await currentBranch(repoName).catch(() => null)
  if (!branch) {
    issues.push('Cannot determine current branch (detached HEAD or corrupt)')
  }

  return {
    healthy: issues.length === 0,
    issues,
    branch,
  }
}

// =====================================================================
//  REMOTE OPERATIONS (GitHub sync via PAT)
// =====================================================================

/** Add a remote to a repo. */
export async function addRemote(repoName, remoteName, url) {
  const dir = getRepoPath(repoName)
  await git.addRemote({ fs, dir, remote: remoteName, url })
}

/** List all remotes. Returns [{ remote, url }]. */
export async function listRemotes(repoName) {
  const dir = getRepoPath(repoName)
  return git.listRemotes({ fs, dir })
}

/** Remove a remote. */
export async function deleteRemote(repoName, remoteName) {
  const dir = getRepoPath(repoName)
  await git.deleteRemote({ fs, dir, remote: remoteName })
}

/** Get the URL for a remote (defaults to 'origin'). */
export async function getRemoteUrl(repoName, remoteName = 'origin') {
  const remotes = await listRemotes(repoName)
  const r = remotes.find((rm) => rm.remote === remoteName)
  return r?.url ?? null
}

/**
 * Fetch from a remote.
 * @param {string} repoName
 * @param {object} [options]  - { remote, ref, singleBranch, depth, onProgress }
 */
export async function fetchRemote(repoName, options = {}) {
  const dir = getRepoPath(repoName)
  const onAuth = await getOnAuth()
  return git.fetch({
    fs,
    http,
    dir,
    remote: options.remote ?? 'origin',
    ref: options.ref,
    singleBranch: options.singleBranch ?? false,
    depth: options.depth,
    onAuth,
    onProgress: options.onProgress,
  })
}

/**
 * Pull (fetch + merge) from a remote.
 * Unlike git.pull(), this supports both fast-forward and real merge commits.
 *
 * Returns { status, oid, conflicts }
 *  - status: 'up-to-date' | 'fast-forward' | 'merged' | 'conflict'
 *  - conflicts: array of filepaths when status === 'conflict'
 */
export async function pullRemote(repoName, options = {}) {
  const dir = getRepoPath(repoName)
  const remote = options.remote ?? 'origin'
  const branch = options.ref ?? (await currentBranch(repoName)) ?? 'main'

  // Step 1: Fetch latest from remote
  await fetchRemote(repoName, {
    remote,
    ref: branch,
    singleBranch: true,
    onProgress: options.onProgress,
  })

  // Step 2: Check if we're already up to date
  const localOid = await git.resolveRef({ fs, dir, ref: branch }).catch(() => null)
  const remoteRef = `${remote}/${branch}`
  const remoteOid = await git.resolveRef({ fs, dir, ref: remoteRef }).catch(() => null)

  if (!remoteOid) {
    return { status: 'up-to-date', oid: localOid, conflicts: null }
  }

  if (localOid === remoteOid) {
    return { status: 'up-to-date', oid: localOid, conflicts: null }
  }

  // Step 3: Try merge (handles both fast-forward and real merges)
  const mergeResult = await mergeBranch(repoName, remoteRef, {
    author: options.author ?? _author,
  })

  if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
    return { status: 'conflict', oid: null, conflicts: mergeResult.conflicts }
  }

  return {
    status: mergeResult.fastForward ? 'fast-forward' : 'merged',
    oid: mergeResult.oid,
    conflicts: null,
  }
}

/**
 * Push to a remote.
 * @param {string} repoName
 * @param {object} [options]  - { remote, ref, force, onProgress }
 */
export async function pushRemote(repoName, options = {}) {
  const dir = getRepoPath(repoName)
  const onAuth = await getOnAuth()
  const branch = options.ref ?? (await currentBranch(repoName)) ?? 'main'
  return git.push({
    fs,
    http,
    dir,
    remote: options.remote ?? 'origin',
    ref: branch,
    force: options.force ?? false,
    onAuth,
    onProgress: options.onProgress,
  })
}

/**
 * Check local vs remote divergence after a fetch.
 * Returns { ahead, behind, localOid, remoteOid }
 */
export async function getRemoteDivergence(repoName, branch) {
  const dir = getRepoPath(repoName)
  const br = branch ?? (await currentBranch(repoName)) ?? 'main'

  let localOid, remoteOid
  try {
    localOid = await git.resolveRef({ fs, dir, ref: br })
  } catch {
    localOid = null
  }
  try {
    remoteOid = await git.resolveRef({ fs, dir, ref: `origin/${br}` })
  } catch {
    remoteOid = null
  }

  if (!localOid || !remoteOid)
    return { ahead: 0, behind: 0, localOid, remoteOid }
  if (localOid === remoteOid)
    return { ahead: 0, behind: 0, localOid, remoteOid }

  // Walk both histories to find common ancestor
  const localLog = await git.log({ fs, dir, ref: br, depth: 100 })
  const remoteLog = await git.log({ fs, dir, ref: `origin/${br}`, depth: 100 })

  const localOids = new Set(localLog.map((c) => c.oid))
  const remoteOids = new Set(remoteLog.map((c) => c.oid))

  const ahead = localLog.filter((c) => !remoteOids.has(c.oid)).length
  const behind = remoteLog.filter((c) => !localOids.has(c.oid)).length

  return { ahead, behind, localOid, remoteOid }
}

/**
 * Clone a repository from GitHub (or any HTTPS remote).
 * Automatically sets up the 'origin' remote.
 * @param {string} url - e.g. https://github.com/user/repo
 * @param {string} repoName - local folder name
 * @param {object} [options]  - { depth, singleBranch, onProgress }
 */
export async function cloneFromGitHub(url, repoName, options = {}) {
  const dir = await createRepoFolder(repoName)
  const onAuth = await getOnAuth()
  await git.clone({
    fs,
    http,
    dir,
    url,
    singleBranch: options.singleBranch ?? false,
    depth: options.depth ?? undefined,
    onAuth,
    onProgress: options.onProgress,
  })
  return dir
}

// =====================================================================
//  HELPERS
// =====================================================================

/** Recursively copy a directory. */
async function copyDirectory(src, dest) {
  await FileSystem.makeDirectoryAsync(dest, { intermediates: true })
  const names = await FileSystem.readDirectoryAsync(src)
  for (const name of names) {
    const srcPath = `${src}/${name}`
    const destPath = `${dest}/${name}`
    const info = await FileSystem.getInfoAsync(srcPath)
    if (info.isDirectory) {
      await copyDirectory(srcPath, destPath)
    } else {
      await FileSystem.copyAsync({ from: srcPath, to: destPath })
    }
  }
}
