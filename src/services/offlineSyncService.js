/**
 * offlineSyncService.js
 *
 * Offline-first sync engine that works directly with isomorphic-git.
 * No backend required — pushes/pulls directly to GitHub via HTTPS + PAT.
 *
 * Architecture:
 *  1. Every commit / branch / tag action is recorded in a local JSON queue.
 *  2. A connectivity listener watches for online status.
 *  3. When online ⇢ drain queue: fetch → rebase-if-needed → push.
 *  4. If remote has new commits ⇢ pull first (FCFS for offline, pull-first for online).
 *  5. On conflict ⇢ surface to user via callback.
 */

import * as FileSystem from 'expo-file-system/legacy'
import { isOnline, onConnectivityChange } from './networkService'
import {
  pushRemote,
  pullRemote,
  fetchRemote,
  getRemoteUrl,
  currentBranch,
  getLog,
} from './gitService'
import { isGitHubLinked } from './githubAuth'

// ── Persistence ────────────────────────────────────────────────────

const QUEUE_FILE = `${FileSystem.documentDirectory}offline_sync_queue.json`
const SYNC_META_FILE = `${FileSystem.documentDirectory}sync_meta.json`

async function _readQueue() {
  try {
    const raw = await FileSystem.readAsStringAsync(QUEUE_FILE)
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function _writeQueue(queue) {
  await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(queue))
}

async function _readMeta() {
  try {
    const raw = await FileSystem.readAsStringAsync(SYNC_META_FILE)
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function _writeMeta(meta) {
  await FileSystem.writeAsStringAsync(SYNC_META_FILE, JSON.stringify(meta))
}

// ── State ──────────────────────────────────────────────────────────

let _processing = false
let _unsubNetwork = null
let _listeners = [] // { event, cb }
let _autoSyncEnabled = true

// ── Events ─────────────────────────────────────────────────────────

/**
 * Subscribe to sync events.
 * Events: 'sync-start', 'sync-success', 'sync-error', 'conflict', 'queue-change', 'online-change'
 * Returns unsubscribe function.
 */
export function onSyncEvent(event, cb) {
  const entry = { event, cb }
  _listeners.push(entry)
  return () => {
    _listeners = _listeners.filter((l) => l !== entry)
  }
}

function _emit(event, data) {
  for (const l of _listeners) {
    if (l.event === event) {
      try {
        l.cb(data)
      } catch {
        /* swallow */
      }
    }
  }
}

// ── Init / Destroy ─────────────────────────────────────────────────

/** Start the offline sync engine. Call once on app boot. */
export function initOfflineSync() {
  _unsubNetwork = onConnectivityChange((online) => {
    _emit('online-change', online)
    if (online && _autoSyncEnabled) {
      drainQueue().catch(() => {})
    }
  })
}

/** Stop the engine. */
export function destroyOfflineSync() {
  if (_unsubNetwork) {
    _unsubNetwork()
    _unsubNetwork = null
  }
}

export function setAutoSync(enabled) {
  _autoSyncEnabled = enabled
}

// ── Queue operations ───────────────────────────────────────────────

/**
 * Record a pending push for a repo.
 * Called after every local commit.
 * @param {string} repoName
 * @param {string} branch
 * @param {string} commitOid
 * @param {string} message - commit message (for display)
 */
export async function enqueuePush(repoName, branch, commitOid, message) {
  const queue = await _readQueue()
  // Deduplicate — if there's already a pending push for this repo+branch, just update the oid
  const existing = queue.find(
    (q) =>
      q.repoName === repoName && q.branch === branch && q.status === 'pending',
  )
  if (existing) {
    existing.commitOid = commitOid
    existing.message = message
    existing.updatedAt = new Date().toISOString()
  } else {
    queue.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      repoName,
      branch,
      commitOid,
      message,
      status: 'pending', // pending | syncing | synced | conflict | error
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }
  await _writeQueue(queue)
  _emit('queue-change', queue)

  // Auto-push if online
  if (isOnline() && _autoSyncEnabled) {
    drainQueue().catch(() => {})
  }
}

/** Get current queue state. */
export async function getQueue() {
  return _readQueue()
}

/** Get pending count for a specific repo (or all). */
export async function getPendingCount(repoName = null) {
  const queue = await _readQueue()
  return queue.filter(
    (q) => q.status === 'pending' && (!repoName || q.repoName === repoName),
  ).length
}

/** Clear completed/error entries from queue. */
export async function clearCompleted() {
  const queue = await _readQueue()
  const cleaned = queue.filter(
    (q) => q.status === 'pending' || q.status === 'syncing',
  )
  await _writeQueue(cleaned)
  _emit('queue-change', cleaned)
}

/** Retry all errored entries. */
export async function retryErrors() {
  const queue = await _readQueue()
  for (const q of queue) {
    if (q.status === 'error') {
      q.status = 'pending'
      q.error = null
    }
  }
  await _writeQueue(queue)
  _emit('queue-change', queue)
  if (isOnline()) drainQueue().catch(() => {})
}

/** Mark a conflict as resolved (user has handled it) and retry push. */
export async function resolveConflictAndRetry(entryId) {
  const queue = await _readQueue()
  const item = queue.find((q) => q.id === entryId)
  if (item) {
    item.status = 'pending'
    item.error = null
  }
  await _writeQueue(queue)
  _emit('queue-change', queue)
  if (isOnline()) drainQueue().catch(() => {})
}

// ── Sync per repo ──────────────────────────────────────────────────

/**
 * Sync a single repo: fetch → check divergence → pull if needed → push.
 * Returns: { status: 'pushed' | 'pulled' | 'up-to-date' | 'conflict', detail? }
 */
export async function syncRepo(repoName) {
  const remoteUrl = await getRemoteUrl(repoName).catch(() => null)
  if (!remoteUrl) throw new Error('No remote origin configured')
  const linked = await isGitHubLinked()
  if (!linked) throw new Error('GitHub PAT not configured')

  const branch = (await currentBranch(repoName)) ?? 'main'

  _emit('sync-start', { repoName, branch })

  try {
    // 1. Fetch remote refs
    await fetchRemote(repoName)

    // 2. Check if we need to pull (remote is ahead)
    let needsPull = false
    let needsPush = false

    try {
      const localLog = await getLog(repoName, { depth: 1, ref: branch })
      const remoteLog = await getLog(repoName, {
        depth: 1,
        ref: `origin/${branch}`,
      }).catch(() => [])

      const localHead = localLog[0]?.oid
      const remoteHead = remoteLog[0]?.oid

      if (!remoteHead) {
        // Remote branch doesn't exist yet — just push
        needsPush = true
      } else if (localHead === remoteHead) {
        // Up to date — check queue for pending pushes
        const queue = await _readQueue()
        needsPush = queue.some(
          (q) =>
            q.repoName === repoName &&
            q.branch === branch &&
            q.status === 'pending',
        )
        if (!needsPush) {
          _emit('sync-success', { repoName, status: 'up-to-date' })
          return { status: 'up-to-date' }
        }
      } else {
        // Check if remote commit is in local history (local is ahead)
        const deepLog = await getLog(repoName, { depth: 50, ref: branch })
        const localHasRemote = deepLog.some((c) => c.oid === remoteHead)

        if (localHasRemote) {
          // Local is ahead — push
          needsPush = true
        } else {
          // Remote is ahead or diverged — need pull
          needsPull = true
          // After pull, also push if we have local commits
          const remoteDeepLog = await getLog(repoName, {
            depth: 50,
            ref: `origin/${branch}`,
          }).catch(() => [])
          const remoteHasLocal = remoteDeepLog.some((c) => c.oid === localHead)
          needsPush = !remoteHasLocal // diverged = true, remote strictly ahead = false
        }
      }
    } catch {
      // Can't determine — try push, let it fail naturally
      needsPush = true
    }

    // 3. Pull if needed (this handles fast-forward + merge)
    if (needsPull) {
      try {
        await pullRemote(repoName, { ref: branch })
      } catch (pullErr) {
        // If pull fails with merge conflict, surface it
        if (
          pullErr?.message?.includes('conflict') ||
          pullErr?.message?.includes('merge') ||
          pullErr?.code === 'MergeConflictError'
        ) {
          _emit('conflict', { repoName, branch, error: pullErr.message })
          return { status: 'conflict', detail: pullErr.message }
        }
        throw pullErr
      }
    }

    // 4. Push
    if (needsPush) {
      try {
        await pushRemote(repoName, { ref: branch })
      } catch (pushErr) {
        // Non-fast-forward — means someone pushed while we were offline
        if (
          pushErr?.message?.includes('not a simple fast-forward') ||
          pushErr?.message?.includes('non-fast-forward')
        ) {
          // Try pull first, then push again
          try {
            await pullRemote(repoName, { ref: branch })
            await pushRemote(repoName, { ref: branch })
          } catch (retryErr) {
            _emit('conflict', { repoName, branch, error: retryErr.message })
            return { status: 'conflict', detail: retryErr.message }
          }
        } else {
          throw pushErr
        }
      }
    }

    const resultStatus =
      needsPull && needsPush
        ? 'pulled'
        : needsPush
          ? 'pushed'
          : needsPull
            ? 'pulled'
            : 'up-to-date'
    _emit('sync-success', { repoName, status: resultStatus })

    // Update sync meta
    const meta = await _readMeta()
    meta[repoName] = {
      lastSync: new Date().toISOString(),
      branch,
      status: resultStatus,
    }
    await _writeMeta(meta)

    return { status: resultStatus }
  } catch (err) {
    _emit('sync-error', { repoName, error: err.message })
    throw err
  }
}

/** Get last sync metadata for a repo. */
export async function getLastSyncInfo(repoName) {
  const meta = await _readMeta()
  return meta[repoName] ?? null
}

// ── Queue drain (auto-push all pending) ────────────────────────────

/**
 * Drain the queue: for each pending entry, try syncRepo.
 * Processes sequentially to avoid races.
 */
export async function drainQueue() {
  if (_processing) return
  if (!isOnline()) return
  const linked = await isGitHubLinked()
  if (!linked) return

  _processing = true
  try {
    const queue = await _readQueue()
    const pending = queue.filter((q) => q.status === 'pending')

    // Group by repo — sync each repo once (covers all pending commits)
    const repos = [...new Set(pending.map((q) => q.repoName))]

    for (const repoName of repos) {
      const remoteUrl = await getRemoteUrl(repoName).catch(() => null)
      if (!remoteUrl) continue // skip repos without remote

      try {
        const result = await syncRepo(repoName)

        // Mark all pending entries for this repo as synced or conflict
        for (const q of queue) {
          if (q.repoName === repoName && q.status === 'pending') {
            q.status = result.status === 'conflict' ? 'conflict' : 'synced'
            q.error = result.status === 'conflict' ? result.detail : null
            q.syncedAt = new Date().toISOString()
          }
        }
      } catch (err) {
        // Mark as error
        for (const q of queue) {
          if (q.repoName === repoName && q.status === 'pending') {
            q.status = 'error'
            q.error = err.message
          }
        }
      }
    }

    await _writeQueue(queue)
    _emit('queue-change', queue)
  } finally {
    _processing = false
  }
}

/**
 * Full sync: fetch all cloned repos with a remote and sync them.
 * Used for "Sync All" button.
 */
export async function syncAll(repoNames) {
  const results = {}
  for (const name of repoNames) {
    try {
      const remoteUrl = await getRemoteUrl(name).catch(() => null)
      if (!remoteUrl) {
        results[name] = { status: 'skipped', detail: 'No remote' }
        continue
      }
      results[name] = await syncRepo(name)
    } catch (err) {
      results[name] = { status: 'error', detail: err.message }
    }
  }
  return results
}
