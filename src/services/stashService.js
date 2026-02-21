/**
 * stashService.js
 *
 * Git stash implementation on top of isomorphic-git.
 * isomorphic-git has no native stash, so we store stashes as JSON
 * in .git/stashes.json – each entry captures the index + working-dir
 * snapshot so it can be restored later.
 */

import * as git from 'isomorphic-git'
import { fs } from '../utils/fsAdapter'
import { getRepoPath } from './repoService'

const STASH_FILE = 'stashes.json'

// =====================================================================
//  INTERNAL HELPERS
// =====================================================================

function stashPath(repoName) {
  return `${getRepoPath(repoName)}/.git/${STASH_FILE}`
}

async function readStashList(repoName) {
  const path = stashPath(repoName)
  try {
    const raw = await fs.promises.readFile(path, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function writeStashList(repoName, stashes) {
  const path = stashPath(repoName)
  await fs.promises.writeFile(path, JSON.stringify(stashes, null, 2), 'utf8')
}

/**
 * Snapshot all tracked + untracked changes in the working directory.
 * Returns a map of { filepath: { content (base64), deleted (bool) } }.
 */
async function captureWorkdirSnapshot(repoName) {
  const dir = getRepoPath(repoName)
  const matrix = await git.statusMatrix({ fs, dir })
  const snapshot = {}

  for (const [filepath, head, workdir] of matrix) {
    if (head === workdir) continue // unmodified

    if (workdir === 0) {
      // Deleted
      snapshot[filepath] = { deleted: true, content: null }
    } else {
      // Modified, added, or untracked – capture content as base64
      try {
        const fullPath = `${dir}/${filepath}`
        const content = await fs.promises.readFile(fullPath, 'utf8')
        snapshot[filepath] = { deleted: false, content }
      } catch {
        // Binary → base64 fallback
        try {
          const fullPath = `${dir}/${filepath}`
          const buf = await fs.promises.readFile(fullPath)
          let binary = ''
          for (let i = 0; i < buf.length; i++)
            binary += String.fromCharCode(buf[i])
          snapshot[filepath] = {
            deleted: false,
            content: btoa(binary),
            encoding: 'base64',
          }
        } catch {
          // skip
        }
      }
    }
  }

  return snapshot
}

/**
 * Restore a snapshot onto the working directory.
 */
async function restoreSnapshot(repoName, snapshot) {
  const dir = getRepoPath(repoName)

  for (const [filepath, entry] of Object.entries(snapshot)) {
    const fullPath = `${dir}/${filepath}`
    if (entry.deleted) {
      try {
        await fs.promises.unlink(fullPath)
      } catch {
        /* already gone */
      }
    } else {
      // Ensure parent directory
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      try {
        await fs.promises.mkdir(parentDir, { recursive: true })
      } catch {
        /* exists */
      }
      if (entry.encoding === 'base64') {
        await fs.promises.writeFile(fullPath, entry.content, 'base64')
      } else {
        await fs.promises.writeFile(fullPath, entry.content, 'utf8')
      }
    }
  }
}

// =====================================================================
//  PUBLIC API
// =====================================================================

/**
 * Stash current changes.
 * @param {string} repoName
 * @param {string} [message] – optional stash message
 * @returns {number} index of the new stash
 */
export async function stash(repoName, message = '') {
  const dir = getRepoPath(repoName)
  const snapshot = await captureWorkdirSnapshot(repoName)

  if (Object.keys(snapshot).length === 0) {
    throw new Error('No local changes to stash')
  }

  // Get current HEAD for reference
  let headOid = null
  try {
    headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
  } catch {
    /* empty repo */
  }

  const stashes = await readStashList(repoName)
  const entry = {
    message:
      message ||
      `WIP on ${(await git.currentBranch({ fs, dir, fullname: false })) ?? 'HEAD'}`,
    timestamp: Date.now(),
    headOid,
    snapshot,
  }
  stashes.unshift(entry) // newest first
  await writeStashList(repoName, stashes)

  // Reset working directory to HEAD
  try {
    const branch = await git.currentBranch({ fs, dir, fullname: false })
    if (branch) {
      await git.checkout({ fs, dir, ref: branch, force: true })
    }
  } catch {
    // If checkout fails, at least the stash is saved
  }

  return 0 // index of newly created stash
}

/**
 * List all stashes.
 */
export async function stashList(repoName) {
  const stashes = await readStashList(repoName)
  return stashes.map((s, i) => ({
    index: i,
    message: s.message,
    timestamp: s.timestamp,
    headOid: s.headOid,
    fileCount: Object.keys(s.snapshot).length,
  }))
}

/**
 * Apply a stash (restore changes) without removing it from the list.
 * @param {number} [index=0] – stash index (0 = latest)
 */
export async function stashApply(repoName, index = 0) {
  const stashes = await readStashList(repoName)
  if (index < 0 || index >= stashes.length) {
    throw new Error(`Stash @{${index}} does not exist`)
  }

  const entry = stashes[index]
  await restoreSnapshot(repoName, entry.snapshot)
  return entry
}

/**
 * Pop a stash – apply and then remove from the list.
 */
export async function stashPop(repoName, index = 0) {
  const entry = await stashApply(repoName, index)
  const stashes = await readStashList(repoName)
  stashes.splice(index, 1)
  await writeStashList(repoName, stashes)
  return entry
}

/**
 * Drop (delete) a stash without applying it.
 */
export async function stashDrop(repoName, index = 0) {
  const stashes = await readStashList(repoName)
  if (index < 0 || index >= stashes.length) {
    throw new Error(`Stash @{${index}} does not exist`)
  }
  const [removed] = stashes.splice(index, 1)
  await writeStashList(repoName, stashes)
  return removed
}

/**
 * Clear all stashes.
 */
export async function stashClear(repoName) {
  await writeStashList(repoName, [])
}

/**
 * Show what files are in a stash entry (without applying).
 */
export async function stashShow(repoName, index = 0) {
  const stashes = await readStashList(repoName)
  if (index < 0 || index >= stashes.length) {
    throw new Error(`Stash @{${index}} does not exist`)
  }

  const entry = stashes[index]
  return Object.entries(entry.snapshot).map(([filepath, data]) => ({
    filepath,
    deleted: data.deleted,
  }))
}
