/**
 * syncQueueService.js
 *
 * On-device offline-first sync queue.
 * ─────────────────────────────────────────────────────────────
 * • Captures git actions (commits, branch ops, tags, merges) into a
 *   local SQLite-backed queue.
 * • Monitors network connectivity via NetInfo.
 * • When online, drains the queue in sequence order by POSTing to
 *   the FastAPI backend, which proxies to GitHub.
 * ─────────────────────────────────────────────────────────────
 */

import * as FileSystem from 'expo-file-system/next'
import NetInfo from '@react-native-community/netinfo'

// ── Configuration ──────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  /** Base URL of the FastAPI sync server */
  serverUrl: 'http://localhost:8000',
  /** Path to the local queue JSON file (SQLite would be better in prod) */
  queuePath: `${FileSystem.documentDirectory}sync_queue.json`,
  /** How often to poll when connectivity listener is unavailable (ms) */
  pollInterval: 30_000,
  /** Max retries per action before giving up */
  maxRetries: 5,
  /** Batch size for queue drain */
  batchSize: 20,
}

let _config = { ...DEFAULT_CONFIG }
let _authToken = null
let _unsubscribeNetInfo = null
let _pollTimer = null
let _processing = false

// ── Public API ─────────────────────────────────────────────────────

/**
 * Initialise the sync queue service.
 * @param {{ serverUrl?: string, authToken: string }} opts
 */
export async function initSyncQueue(opts = {}) {
  if (opts.serverUrl) _config.serverUrl = opts.serverUrl
  if (opts.authToken) _authToken = opts.authToken
  if (opts.pollInterval) _config.pollInterval = opts.pollInterval

  // Ensure queue file exists
  await _ensureQueueFile()

  // Start watching connectivity
  _startConnectivityWatch()
}

/** Stop watching and clean up. */
export function destroySyncQueue() {
  if (_unsubscribeNetInfo) {
    _unsubscribeNetInfo()
    _unsubscribeNetInfo = null
  }
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

/** Update the auth token (e.g. after login). */
export function setAuthToken(token) {
  _authToken = token
}

/**
 * Enqueue a sync action.
 * @param {number} repoId
 * @param {string} actionType – one of the SyncActionType enum values
 * @param {object} payload – action-specific data
 * @returns {object} the queued action
 */
export async function enqueueAction(repoId, actionType, payload = {}) {
  const queue = await _readQueue()
  const action = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    repoId,
    actionType,
    payload,
    status: 'pending',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    sequence: queue.length + 1,
  }
  queue.push(action)
  await _writeQueue(queue)

  // Try to drain immediately if online
  _tryDrain()

  return action
}

/**
 * Enqueue a batch of ordered actions.
 */
export async function enqueueBatch(repoId, actions) {
  const queue = await _readQueue()
  const baseSeq = queue.length + 1
  const created = actions.map((a, i) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    repoId,
    actionType: a.actionType,
    payload: a.payload || {},
    status: 'pending',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    sequence: baseSeq + i,
  }))
  queue.push(...created)
  await _writeQueue(queue)
  _tryDrain()
  return created
}

/** Get pending actions for a repo (or all repos). */
export async function getPendingActions(repoId = null) {
  const queue = await _readQueue()
  return queue.filter(
    (a) => a.status === 'pending' && (repoId === null || a.repoId === repoId),
  )
}

/** Get full queue status summary. */
export async function getQueueStatus(repoId = null) {
  const queue = await _readQueue()
  const filtered = repoId ? queue.filter((a) => a.repoId === repoId) : queue

  const counts = { pending: 0, processing: 0, completed: 0, failed: 0 }
  for (const a of filtered) {
    counts[a.status] = (counts[a.status] || 0) + 1
  }
  return { total: filtered.length, ...counts }
}

/** Cancel a pending/failed action by id. */
export async function cancelAction(actionId) {
  const queue = await _readQueue()
  const idx = queue.findIndex(
    (a) => a.id === actionId && ['pending', 'failed'].includes(a.status),
  )
  if (idx === -1) return false
  queue.splice(idx, 1)
  await _writeQueue(queue)
  return true
}

/** Retry all failed actions (reset to pending). */
export async function retryAllFailed(repoId = null) {
  const queue = await _readQueue()
  let count = 0
  for (const a of queue) {
    if (
      a.status === 'failed' &&
      a.retryCount < _config.maxRetries &&
      (repoId === null || a.repoId === repoId)
    ) {
      a.status = 'pending'
      a.error = null
      count++
    }
  }
  await _writeQueue(queue)
  _tryDrain()
  return count
}

/** Purge completed actions from the local queue. */
export async function purgeCompleted() {
  const queue = await _readQueue()
  const cleaned = queue.filter((a) => a.status !== 'completed')
  await _writeQueue(cleaned)
  return queue.length - cleaned.length
}

/** Manually trigger a queue drain. */
export async function forceDrain() {
  return _drain()
}

/**
 * Pull updates from the server for a repo.
 * @param {number} repoId
 * @param {string|null} fromOid – last known OID (null for full pull)
 */
export async function pullUpdates(repoId, fromOid = null) {
  const resp = await _apiPost('/sync/pull', {
    repo_id: repoId,
    from_oid: fromOid,
  })
  return resp
}

// ── Connectivity watcher ───────────────────────────────────────────

function _startConnectivityWatch() {
  try {
    _unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        _tryDrain()
      }
    })
  } catch {
    // NetInfo not available — fall back to polling
    _pollTimer = setInterval(async () => {
      try {
        const resp = await fetch(`${_config.serverUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        })
        if (resp.ok) _tryDrain()
      } catch {
        /* offline — ignore */
      }
    }, _config.pollInterval)
  }
}

// ── Queue drain ────────────────────────────────────────────────────

function _tryDrain() {
  if (_processing) return
  _drain().catch(() => {})
}

async function _drain() {
  if (_processing || !_authToken) return
  _processing = true

  try {
    const queue = await _readQueue()
    const pending = queue
      .filter((a) => a.status === 'pending')
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, _config.batchSize)

    if (pending.length === 0) return

    // Group by repo for batch submission
    const byRepo = {}
    for (const a of pending) {
      if (!byRepo[a.repoId]) byRepo[a.repoId] = []
      byRepo[a.repoId].push(a)
    }

    for (const [repoId, actions] of Object.entries(byRepo)) {
      try {
        // Submit batch to server
        const serverActions = actions.map((a) => ({
          action_type: a.actionType,
          payload: a.payload,
        }))

        await _apiPost('/sync/queue/batch', {
          repo_id: parseInt(repoId, 10),
          actions: serverActions,
        })

        // Trigger server-side processing
        await _apiPost(`/sync/process/${repoId}`)

        // Mark local actions as completed
        for (const a of actions) {
          const item = queue.find((q) => q.id === a.id)
          if (item) {
            item.status = 'completed'
            item.syncedAt = new Date().toISOString()
          }
        }
      } catch (err) {
        // Mark as failed with error
        for (const a of actions) {
          const item = queue.find((q) => q.id === a.id)
          if (item) {
            item.status = 'failed'
            item.error = err.message
            item.retryCount = (item.retryCount || 0) + 1
          }
        }
      }
    }

    await _writeQueue(queue)
  } finally {
    _processing = false
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────

async function _apiPost(path, body) {
  const resp = await fetch(`${_config.serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_authToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`API ${path} → ${resp.status}: ${text.slice(0, 300)}`)
  }
  if (resp.status === 204) return {}
  return resp.json()
}

async function _apiGet(path) {
  const resp = await fetch(`${_config.serverUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${_authToken}`,
    },
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`API ${path} → ${resp.status}: ${text.slice(0, 300)}`)
  }
  return resp.json()
}

// ── Local queue persistence (JSON file) ────────────────────────────

async function _ensureQueueFile() {
  try {
    const info = await FileSystem.getInfoAsync(_config.queuePath)
    if (!info.exists) {
      await FileSystem.writeAsStringAsync(_config.queuePath, '[]')
    }
  } catch {
    await FileSystem.writeAsStringAsync(_config.queuePath, '[]')
  }
}

async function _readQueue() {
  try {
    const raw = await FileSystem.readAsStringAsync(_config.queuePath)
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function _writeQueue(queue) {
  await FileSystem.writeAsStringAsync(_config.queuePath, JSON.stringify(queue))
}
