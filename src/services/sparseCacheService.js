/**
 * sparseCacheService.js
 *
 * LRU (Least Recently Used) disk cache for sparse/lazy-cloned repos.
 *
 * Maintains a 20 MB cap on the total working-tree files that are materialized
 * on device storage. When new file data is needed and the cap would be
 * exceeded, the least-recently-accessed files are evicted (deleted from disk)
 * first, so their content will be re-fetched from the .git blob store the next
 * time the user wants them.
 *
 * The manifest is stored at <repoDir>/.sparse_manifest.json and tracks:
 *   { totalSize: number, files: { [filepath]: { size, lastAccessed } } }
 */

import * as FileSystem from 'expo-file-system/legacy'
import { getRepoPath } from './repoService'
import * as git from 'isomorphic-git'
import { fs } from '../utils/fsAdapter'
import { atomicWriteJson, safeReadJson } from './safeWriteService'

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum total bytes of materialized working-tree files to keep on disk. */
const MAX_CACHE_BYTES = 20 * 1024 * 1024  // 20 MB

/**
 * Maximum bytes we attempt to load into JavaScript memory.
 * Files larger than this will be marked as tooLargeForEditor.
 * Set to 5 MB — large enough to display most code files, safe from OOM.
 */
export const MAX_DISPLAY_BYTES = 5 * 1024 * 1024  // 5 MB

/**
 * Hard cap on the largest single file we'll attempt to read into JS memory.
 * 10 MB chosen to stay well within safe allocation range on Android/iOS.
 */
const MAX_BLOB_READ_BYTES = 10 * 1024 * 1024  // 10 MB

const MANIFEST_NAME = '.sparse_manifest.json'

// ── Manifest helpers ─────────────────────────────────────────────────────────

function manifestPath(repoName) {
  return `${getRepoPath(repoName)}/${MANIFEST_NAME}`
}

async function readManifest(repoName) {
  return safeReadJson(manifestPath(repoName), { totalSize: 0, files: {} })
}

async function writeManifest(repoName, manifest) {
  await atomicWriteJson(manifestPath(repoName), manifest)
}

// ── Loose object size pre-check ──────────────────────────────────────────────

/**
 * Try to estimate the size of a git blob by statting the loose object file.
 * Returns the compressed file size (a lower-bound proxy) or null if the
 * object is packed (common for cloned repos).
 */
async function getLooseObjectSize(dir, oid) {
  try {
    const loosePath = `${dir}/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`
    const info = await FileSystem.getInfoAsync(loosePath, { size: true })
    if (info.exists && info.size != null) return info.size
  } catch { /* ignore */ }
  return null  // packed object – size unknown without reading
}

// ── LRU eviction ─────────────────────────────────────────────────────────────

async function evictLRU(repoName, manifest, bytesNeeded) {
  const dir = getRepoPath(repoName)
  const sorted = Object.entries(manifest.files).sort(
    ([, a], [, b]) => a.lastAccessed - b.lastAccessed,
  )
  let freed = 0
  const target = (manifest.totalSize + bytesNeeded) - MAX_CACHE_BYTES
  for (const [filepath, meta] of sorted) {
    if (freed >= target) break
    const fullPath = `${dir}/${filepath}`
    try {
      await FileSystem.deleteAsync(fullPath, { idempotent: true })
      freed += meta.size
      manifest.totalSize -= meta.size
      delete manifest.files[filepath]
    } catch { /* ignore */ }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Materialize a file from the git blob store onto the device filesystem.
 *
 * Handles ALL of: blob reading, OOM-safe size checks, LRU eviction,
 * disk write, and manifest update.
 *
 * Returns:
 *   { content: string|null, tooLargeForEditor: boolean, oomError: boolean,
 *     sizeMB: string, path: string }
 *
 * @param {string} repoName
 * @param {string} filepath – relative path inside the repo
 * @param {string} ref – git ref (default 'HEAD')
 */
export async function materializeFile(repoName, filepath, ref = 'HEAD') {
  const dir = getRepoPath(repoName)
  const fullPath = `${dir}/${filepath}`
  const manifest = await readManifest(repoName)
  const now = Date.now()

  // ── Already on disk ──────────────────────────────────────────────────────
  const existing = manifest.files[filepath]
  const alreadyOnDisk = await FileSystem.getInfoAsync(fullPath)
    .then(i => i.exists).catch(() => false)

  if (existing && alreadyOnDisk) {
    manifest.files[filepath].lastAccessed = now
    await writeManifest(repoName, manifest)
    const sizeMB = (existing.size / 1024 / 1024).toFixed(1)
    if (existing.size > MAX_DISPLAY_BYTES) {
      return { path: fullPath, content: null, tooLargeForEditor: true, oomError: false, sizeMB }
    }
    const content = await FileSystem.readAsStringAsync(fullPath, {
      encoding: FileSystem.EncodingType.UTF8,
    })
    return { path: fullPath, content, tooLargeForEditor: false, oomError: false, sizeMB }
  }

  // ── Pre-check loose object size ──────────────────────────────────────────
  let blobOid = null
  try {
    const commitOid = await git.resolveRef({ fs, dir, ref })
    const treeOid = await git.readTree({ fs, dir, oid: commitOid })
      .then(t => t.tree.find(e => e.path === filepath.split('/').pop())?.oid)
      .catch(() => null)
    // Fall back to resolving blob via walk if tree lookup fails
    if (!treeOid) {
      // Walk to get blob oid for nested paths
      const results = await git.walk({
        fs, dir,
        trees: [git.TREE({ ref })],
        map: async (path, [entry]) => {
          if (entry === null) return
          if (path === filepath) return entry.oid()
        },
      })
      blobOid = results.find(r => typeof r === 'string') ?? null
    } else {
      blobOid = treeOid
    }
  } catch { /* can't resolve oid – proceed anyway */ }

  if (blobOid) {
    const looseSize = await getLooseObjectSize(dir, blobOid)
    // Compressed size > 5MB implies actual size likely > 15–20MB (for code files)
    if (looseSize !== null && looseSize > 5 * 1024 * 1024) {
      const estimatedMB = ((looseSize * 4) / 1024 / 1024).toFixed(1)
      return {
        path: fullPath, content: null,
        tooLargeForEditor: true, oomError: false,
        sizeMB: `~${estimatedMB}`,
      }
    }
  }

  // ── Read blob from git ───────────────────────────────────────────────────
  let blob
  try {
    const commitOid = await git.resolveRef({ fs, dir, ref })
    const result = await git.readBlob({ fs, dir, oid: commitOid, filepath })
    blob = result.blob
  } catch (e) {
    // Catch OOM-style allocation errors from the JS engine
    const msg = e?.message ?? ''
    if (
      msg.includes('allocat') ||
      msg.includes('out of memory') ||
      msg.includes('Cannot allocate') ||
      msg.includes('RangeError')
    ) {
      return {
        path: fullPath, content: null,
        tooLargeForEditor: true, oomError: true,
        sizeMB: '?',
      }
    }
    throw e
  }

  const newSize = blob.byteLength
  const sizeMB = (newSize / 1024 / 1024).toFixed(1)

  // ── If file is still very large but didn't OOM – stash it to disk only ──
  // We cache it (LRU) but don't display it in the text editor
  const tooLargeForEditor = newSize > MAX_DISPLAY_BYTES

  // Make room in the LRU cache
  if (manifest.totalSize + newSize > MAX_CACHE_BYTES) {
    await evictLRU(repoName, manifest, newSize)
  }

  // If a single file would exceed the entire cache budget, skip caching silently
  if (newSize > MAX_CACHE_BYTES) {
    return { path: fullPath, content: null, tooLargeForEditor: true, oomError: false, sizeMB }
  }

  // Write to disk
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'))
  const parentInfo = await FileSystem.getInfoAsync(parentDir)
  if (!parentInfo.exists) {
    await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true })
  }
  const base64 = uint8ToBase64(blob)
  await FileSystem.writeAsStringAsync(fullPath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })

  // Update manifest
  manifest.files[filepath] = { size: newSize, lastAccessed: now }
  manifest.totalSize += newSize
  await writeManifest(repoName, manifest)

  if (tooLargeForEditor) return { path: fullPath, content: null, tooLargeForEditor, oomError: false, sizeMB }

  const content = await FileSystem.readAsStringAsync(fullPath, {
    encoding: FileSystem.EncodingType.UTF8,
  })
  return { path: fullPath, content, tooLargeForEditor: false, oomError: false, sizeMB }
}

/**
 * Mark a file as recently accessed in the manifest.
 */
export async function touchCacheEntry(repoName, filepath) {
  const manifest = await readManifest(repoName)
  if (manifest.files[filepath]) {
    manifest.files[filepath].lastAccessed = Date.now()
    await writeManifest(repoName, manifest)
  }
}

/**
 * Return cache stats for the repo.
 * @returns {{ totalSize: number, fileCount: number, maxSize: number }}
 */
export async function getCacheStats(repoName) {
  const manifest = await readManifest(repoName)
  return {
    totalSize: manifest.totalSize,
    fileCount: Object.keys(manifest.files).length,
    maxSize: MAX_CACHE_BYTES,
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function uint8ToBase64(bytes) {
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
