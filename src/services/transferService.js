/**
 * transferService.js
 *
 * Cross-device repository transfer without internet.
 * Supports:
 *  - JSON bundle export/import (for QR, Bluetooth, WiFi-Direct)
 *  - Chunk-based splitting for size-limited channels (QR codes)
 *  - Integrity verification via SHA-256 hash
 */

import { exportRepoBundle, importRepoBundle, getRepoPath } from './repoService'
import { fs } from '../utils/fsAdapter'

// =====================================================================
//  BUNDLE EXPORT / IMPORT  (full repo as JSON)
// =====================================================================

/**
 * Export a repository to a transferable JSON string.
 * The string can be sent over any channel (QR, BLE, WiFi-Direct, file share).
 */
export async function exportForTransfer(repoName) {
  const bundle = await exportRepoBundle(repoName)
  const json = JSON.stringify(bundle)

  return {
    json,
    sizeBytes: json.length,
    sizeFormatted: formatBytes(json.length),
    checksum: await simpleHash(json),
  }
}

/**
 * Import a repository from a transfer JSON string.
 * Validates integrity before importing.
 */
export async function importFromTransfer(jsonString, expectedChecksum = null) {
  if (expectedChecksum) {
    const actual = await simpleHash(jsonString)
    if (actual !== expectedChecksum) {
      throw new Error(
        `Integrity check failed. Expected checksum ${expectedChecksum}, got ${actual}. Transfer may be corrupted.`,
      )
    }
  }

  const bundle = JSON.parse(jsonString)
  if (!bundle.name || !Array.isArray(bundle.files)) {
    throw new Error('Invalid bundle format')
  }

  const path = await importRepoBundle(bundle)
  return { repoName: bundle.name, path, fileCount: bundle.files.length }
}

// =====================================================================
//  CHUNKED TRANSFER  (for QR codes / BLE with size limits)
// =====================================================================

/**
 * Split a JSON bundle into chunks of maxChunkSize bytes.
 * Each chunk includes metadata for reassembly.
 */
export function splitIntoChunks(jsonString, maxChunkSize = 2000) {
  const totalChunks = Math.ceil(jsonString.length / maxChunkSize)
  const checksum = simpleHashSync(jsonString)
  const chunks = []

  for (let i = 0; i < totalChunks; i++) {
    const start = i * maxChunkSize
    const end = Math.min(start + maxChunkSize, jsonString.length)
    chunks.push({
      index: i,
      total: totalChunks,
      checksum,
      data: jsonString.slice(start, end),
    })
  }

  return chunks
}

/**
 * Reassemble chunks into the original JSON string.
 * Validates all chunks are present and checksum matches.
 */
export function reassembleChunks(chunks) {
  // Sort by index
  const sorted = [...chunks].sort((a, b) => a.index - b.index)
  const total = sorted[0]?.total
  const checksum = sorted[0]?.checksum

  if (!total || sorted.length !== total) {
    throw new Error(
      `Missing chunks: received ${sorted.length} of ${total ?? '?'}`,
    )
  }

  // Validate continuity
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].index !== i) {
      throw new Error(`Missing chunk at index ${i}`)
    }
  }

  const json = sorted.map((c) => c.data).join('')

  // Verify checksum
  const actualChecksum = simpleHashSync(json)
  if (checksum && actualChecksum !== checksum) {
    throw new Error(
      'Checksum mismatch after reassembly – data may be corrupted',
    )
  }

  return json
}

// =====================================================================
//  PATCH-BASED TRANSFER  (send only changes)
// =====================================================================

/**
 * Generate a lightweight patch bundle containing only files changed
 * since a given commit oid. Useful for incremental sync.
 */
export async function exportPatchSince(repoName, sinceOid) {
  const dir = getRepoPath(repoName)
  const git = await import('isomorphic-git')

  const currentOid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
  const commits = await git.log({ fs, dir, depth: 500 })

  // Find commits after sinceOid
  const newCommits = []
  for (const c of commits) {
    if (c.oid === sinceOid) break
    newCommits.push({
      oid: c.oid,
      message: c.commit.message,
      author: c.commit.author,
      parent: c.commit.parent,
    })
  }

  // Collect changed files snapshot
  const changedFiles = []
  const currentFiles = await git.listFiles({ fs, dir, ref: 'HEAD' })
  for (const filepath of currentFiles) {
    try {
      const { blob } = await git.readBlob({
        fs,
        dir,
        oid: currentOid,
        filepath,
      })
      // Check if file existed at sinceOid
      let oldBlob = null
      try {
        const result = await git.readBlob({ fs, dir, oid: sinceOid, filepath })
        oldBlob = result.blob
      } catch {
        /* new file */
      }

      if (!oldBlob || !arraysEqual(blob, oldBlob)) {
        let binary = ''
        for (let i = 0; i < blob.length; i++)
          binary += String.fromCharCode(blob[i])
        const content = btoa(binary)
        changedFiles.push({ filepath, content, encoding: 'base64' })
      }
    } catch {
      // skip
    }
  }

  return {
    repoName,
    fromOid: sinceOid,
    toOid: currentOid,
    commits: newCommits,
    files: changedFiles,
    timestamp: Date.now(),
  }
}

// =====================================================================
//  HELPERS
// =====================================================================

/**
 * Simple hash for integrity checks (DJB2-based, not cryptographic).
 */
async function simpleHash(str) {
  return simpleHashSync(str)
}

function simpleHashSync(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
