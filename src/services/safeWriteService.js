/**
 * safeWriteService.js
 *
 * Crash-safe I/O utilities for the git mobile client.
 *
 * Problems it solves:
 *  1. Manifest corruption (.quick_browse.json, .sparse_manifest.json) –
 *     Uses an atomic write: write to <file>.tmp first, then rename.
 *     On most Unix-like filesystems (including iOS/Android ext4 / APFS),
 *     the rename is atomic, so a crash never leaves a truncated file.
 *
 *  2. Git operation crash detection –
 *     Before a destructive git op (commit, merge, rebase) we write a
 *     `.gitops_lock` file. After success we remove it. On next open we
 *     detect a stale lock and offer the user a recovery action.
 *
 *  3. Internet-drop-safe push / fetch –
 *     The underlying git transport leaves the LOCAL repo untouched if the
 *     remote call fails. We just surface the error clearly and let the
 *     user retry via the offline sync queue.
 */

import * as FileSystem from 'expo-file-system/legacy'
import { getRepoPath } from './repoService'

// ── Atomic write ─────────────────────────────────────────────────────────────

/**
 * Write a string to `path` atomically.
 *
 * Strategy:
 *   1. Write content to `<path>.tmp`
 *   2. Move (rename) `.tmp` → `path`
 *
 * A crash between steps 1 and 2 leaves a stale `.tmp` file but the original
 * `path` is unchanged. A crash after step 2 is safe because the rename is
 * atomic on APFS / ext4.
 *
 * @param {string} path     Absolute path to the target file
 * @param {string} content  String content to write
 * @param {FileSystem.EncodingType} [encoding]
 */
export async function atomicWriteString(path, content, encoding = FileSystem.EncodingType.UTF8) {
  const tmp = path + '.tmp'
  try {
    await FileSystem.writeAsStringAsync(tmp, content, { encoding })
    // Move is atomic on APFS (iOS) and ext4 (Android)
    await FileSystem.moveAsync({ from: tmp, to: path })
  } catch (err) {
    // Clean up orphaned .tmp on any failure
    await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {})
    throw err
  }
}

/**
 * Write a JSON-serialisable value atomically.
 */
export async function atomicWriteJson(path, data) {
  await atomicWriteString(path, JSON.stringify(data))
}

/**
 * Safely read a JSON file. If the main file is corrupt/missing, falls back to
 * the `.tmp` file (which contains the *previous* good write).
 *
 * Returns `null` when no valid data can be found.
 */
export async function safeReadJson(path, fallback = null) {
  // Try main file first
  try {
    const raw = await FileSystem.readAsStringAsync(path)
    return JSON.parse(raw)
  } catch { /* corrupt or missing */ }

  // Try .tmp as fallback (previous good state)
  try {
    const raw = await FileSystem.readAsStringAsync(path + '.tmp')
    return JSON.parse(raw)
  } catch { /* also missing */ }

  return fallback
}

// ── Git operation lock ────────────────────────────────────────────────────────

const LOCK_NAME = '.gitops_lock'

function lockPath(repoName) {
  return `${getRepoPath(repoName)}/${LOCK_NAME}`
}

/**
 * Write an operation lock before starting a git mutation.
 * @param {string} repoName
 * @param {string} operation  Human-readable name, e.g. 'commit', 'merge'
 */
export async function acquireGitLock(repoName, operation) {
  const lock = {
    operation,
    pid: 'app',          // React Native doesn't expose PIDs; use 'app' as sentinel
    startedAt: Date.now(),
  }
  await atomicWriteJson(lockPath(repoName), lock)
}

/**
 * Remove the lock after a successful operation.
 */
export async function releaseGitLock(repoName) {
  await FileSystem.deleteAsync(lockPath(repoName), { idempotent: true }).catch(() => {})
}

/**
 * Check if a stale lock exists (left by a previous crash).
 * Returns the lock data or `null` if no lock is present.
 */
export async function checkStaleLock(repoName) {
  return safeReadJson(lockPath(repoName), null)
}

/**
 * Clear a stale lock (call after user acknowledges recovery).
 */
export async function clearStaleLock(repoName) {
  await releaseGitLock(repoName)
}

// ── Wrapped git operations with lock ─────────────────────────────────────────

/**
 * Run a git mutation function with automatic lock acquire/release.
 *
 * Usage:
 *   const result = await withGitLock('my-repo', 'commit', () => commitAll('my-repo', 'msg'))
 *
 * @param {string}    repoName
 * @param {string}    operation  Label shown in the lock file
 * @param {Function}  fn         Async function to run
 */
export async function withGitLock(repoName, operation, fn) {
  await acquireGitLock(repoName, operation)
  try {
    const result = await fn()
    await releaseGitLock(repoName)
    return result
  } catch (err) {
    // Release the lock even on failure so the user isn't permanently blocked.
    // The stale lock is only left if the *process itself* dies (crash / OOM).
    await releaseGitLock(repoName)
    throw err
  }
}

// ── Git health check ──────────────────────────────────────────────────────────

/**
 * Inspect the .git directory for signs of a previously aborted operation.
 * Returns an array of { file, description } issues found.
 *
 * Known bad states:
 *   MERGE_HEAD     – merge started but not committed
 *   CHERRY_PICK_HEAD – cherry-pick in progress
 *   REVERT_HEAD    – revert in progress
 *   BISECT_LOG     – bisect session active
 *   rebase-merge/  – interactive rebase in progress
 *   rebase-apply/  – am/rebase apply in progress
 */
export async function detectGitHealthIssues(repoName) {
  const gitDir = `${getRepoPath(repoName)}/.git`
  const SIGNALS = [
    { file: 'MERGE_HEAD',       description: 'An unfinished merge needs to be completed or aborted.' },
    { file: 'CHERRY_PICK_HEAD', description: 'A cherry-pick is in progress.' },
    { file: 'REVERT_HEAD',      description: 'A revert is in progress.' },
    { file: 'rebase-merge',     description: 'An interactive rebase is in progress.' },
    { file: 'rebase-apply',     description: 'A rebase or am operation is in progress.' },
  ]

  const issues = []
  for (const { file, description } of SIGNALS) {
    try {
      const info = await FileSystem.getInfoAsync(`${gitDir}/${file}`)
      if (info.exists) issues.push({ file, description })
    } catch { /* skip */ }
  }
  return issues
}
