/**
 * quickBrowseService.js
 *
 * GitHub API-based "Quick Browse" mode for large repositories.
 *
 * Instead of cloning the repo, this service:
 *   1. Fetches the complete file tree from the GitHub API (a few KB of JSON)
 *   2. Downloads individual files on demand when the user taps them
 *   3. Commits changes back via the GitHub Contents API (no local git needed)
 *
 * A marker file `.quick_browse.json` inside the repo directory stores:
 *   { owner, repo, branch, treeSha, tree: [{path, sha, size, type}...] }
 *
 * Downloaded files are stored at <repoDir>/<filepath> and their current SHA
 * is tracked in the manifest so we can commit updates correctly.
 */

import * as FileSystem from 'expo-file-system/legacy'
import { getRepoPath, createRepoFolder } from './repoService'

const MARKER_NAME = '.quick_browse.json'
const BASE_URL = 'https://api.github.com'

// ── Auth helper ──────────────────────────────────────────────────────────────

async function getToken() {
  const AUTH_FILE = `${FileSystem.documentDirectory}github_auth.json`
  try {
    const raw = await FileSystem.readAsStringAsync(AUTH_FILE)
    const data = JSON.parse(raw)
    return data?.token ?? null
  } catch {
    return null
  }
}

async function ghFetch(path, options = {}) {
  const token = await getToken()
  if (!token) throw new Error('GitHub PAT not configured. Please set it in Settings.')
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`GitHub API ${resp.status}: ${body.slice(0, 200)}`)
  }
  return resp.json()
}

// ── Marker helpers ───────────────────────────────────────────────────────────

function markerPath(repoName) {
  return `${getRepoPath(repoName)}/${MARKER_NAME}`
}

async function readMarker(repoName) {
  try {
    const raw = await FileSystem.readAsStringAsync(markerPath(repoName))
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeMarker(repoName, data) {
  await FileSystem.writeAsStringAsync(markerPath(repoName), JSON.stringify(data))
}

// ── Public: detect ───────────────────────────────────────────────────────────

/**
 * Returns true if this repo was created via Quick Browse (no local git).
 */
export async function isQuickBrowseRepo(repoName) {
  try {
    const info = await FileSystem.getInfoAsync(markerPath(repoName))
    return info.exists
  } catch {
    return false
  }
}

// ── Public: setup ────────────────────────────────────────────────────────────

/**
 * Parse a GitHub URL into { owner, repo }.
 * Supports: https://github.com/owner/repo[.git]
 */
export function parseGitHubUrl(url) {
  const m = url.trim().match(/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/)
  if (!m) throw new Error('Could not parse GitHub URL. Expected: https://github.com/owner/repo')
  return { owner: m[1], repo: m[2] }
}

/**
 * Create a Quick Browse repo entry (no git clone, just API tree fetch).
 * @param {string} url - GitHub HTTPS URL
 * @param {string} repoName - local folder name
 * @param {string} [branch] - branch to browse (default: repo's default branch)
 */
export async function quickBrowseClone(url, repoName, branch) {
  const { owner, repo } = parseGitHubUrl(url)

  // Get default branch if not specified
  if (!branch) {
    const repoMeta = await ghFetch(`/repos/${owner}/${repo}`)
    branch = repoMeta.default_branch ?? 'main'
  }

  // Fetch the complete recursive tree - just metadata, no file content
  const treeData = await ghFetch(
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  )

  // Filter to files only (exclude trees/dirs), keep path + sha + size
  const tree = (treeData.tree ?? [])
    .filter(e => e.type === 'blob')
    .map(e => ({ path: e.path, sha: e.sha, size: e.size ?? 0 }))

  // Create local directory
  const dir = await createRepoFolder(repoName)

  // Write marker (no actual files downloaded yet!)
  await writeMarker(repoName, {
    owner,
    repo,
    branch,
    treeSha: treeData.sha,
    tree,
    downloadedFiles: {},  // filepath → { sha, localSize }
  })

  return dir
}

// ── Public: file tree ────────────────────────────────────────────────────────

/**
 * Return a flat list of all file paths in the repo (from the cached tree).
 * This is instant — no network call needed.
 */
export async function listQuickBrowseFiles(repoName) {
  const marker = await readMarker(repoName)
  if (!marker) return []
  return marker.tree.map(e => e.path)
}

/**
 * Return tree metadata for a specific file path (sha, size).
 */
export async function getFileTreeEntry(repoName, filepath) {
  const marker = await readMarker(repoName)
  if (!marker) return null
  return marker.tree.find(e => e.path === filepath) ?? null
}

// ── Public: on-demand file fetch ─────────────────────────────────────────────

/**
 * Download a file from GitHub and save it locally.
 * If already downloaded and unmodified, returns cached version.
 *
 * @returns {{ content: string, sha: string, size: number, fromCache: boolean }}
 */
export async function fetchQuickBrowseFile(repoName, filepath) {
  const marker = await readMarker(repoName)
  if (!marker) throw new Error('Not a Quick Browse repo')

  const dir = getRepoPath(repoName)
  const localPath = `${dir}/${filepath}`

  // Check if already on disk
  const existing = marker.downloadedFiles?.[filepath]
  const onDisk = await FileSystem.getInfoAsync(localPath).then(i => i.exists).catch(() => false)

  if (existing && onDisk) {
    const content = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.UTF8,
    })
    return { content, sha: existing.sha, size: existing.localSize, fromCache: true }
  }

  // Fetch from GitHub API
  const { owner, repo, branch } = marker
  const data = await ghFetch(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(filepath)}?ref=${branch}`
  )

  // GitHub returns file content as base64
  if (!data.content) throw new Error('No content returned from GitHub API')
  const content = atob(data.content.replace(/\n/g, ''))

  // Check size before writing
  const byteSize = data.size ?? content.length
  if (byteSize > 5 * 1024 * 1024) {
    throw new Error(`FILE_TOO_LARGE:${(byteSize / 1024 / 1024).toFixed(1)}`)
  }

  // Ensure parent directory exists
  const parentDir = localPath.substring(0, localPath.lastIndexOf('/'))
  const parentInfo = await FileSystem.getInfoAsync(parentDir)
  if (!parentInfo.exists) {
    await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true })
  }

  // Write to disk
  await FileSystem.writeAsStringAsync(localPath, content, {
    encoding: FileSystem.EncodingType.UTF8,
  })

  // Update manifest
  marker.downloadedFiles = marker.downloadedFiles ?? {}
  marker.downloadedFiles[filepath] = { sha: data.sha, localSize: byteSize }
  await writeMarker(repoName, marker)

  return { content, sha: data.sha, size: byteSize, fromCache: false }
}

// ── Public: commit via API ────────────────────────────────────────────────────

/**
 * Commit a file change directly to GitHub via the Contents API.
 * Handles both creating new files and updating existing ones.
 *
 * @param {string} repoName
 * @param {string} filepath
 * @param {string} content - new file content (utf-8 string)
 * @param {string} message - commit message
 * @returns {Promise<{ sha: string, commitUrl: string }>}
 */
export async function commitQuickBrowseFile(repoName, filepath, content, message) {
  const marker = await readMarker(repoName)
  if (!marker) throw new Error('Not a Quick Browse repo')

  const { owner, repo, branch } = marker
  const existingEntry = marker.downloadedFiles?.[filepath]

  // GitHub requires content as base64
  const contentBase64 = btoa(unescape(encodeURIComponent(content)))

  const body = {
    message,
    content: contentBase64,
    branch,
    ...(existingEntry?.sha ? { sha: existingEntry.sha } : {}),
  }

  const result = await ghFetch(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(filepath)}`,
    { method: 'PUT', body: JSON.stringify(body) }
  )

  const newSha = result.content?.sha ?? existingEntry?.sha
  if (newSha) {
    marker.downloadedFiles = marker.downloadedFiles ?? {}
    marker.downloadedFiles[filepath] = { sha: newSha, localSize: content.length }

    // Also update the tree entry sha
    const treeEntry = marker.tree.find(e => e.path === filepath)
    if (treeEntry) treeEntry.sha = newSha

    await writeMarker(repoName, marker)
  }

  return {
    sha: result.commit?.sha ?? '',
    commitUrl: result.commit?.html_url ?? '',
  }
}

/**
 * Get the GitHub web URL for the repo (for display).
 */
export async function getQuickBrowseRepoUrl(repoName) {
  const marker = await readMarker(repoName)
  if (!marker) return null
  return `https://github.com/${marker.owner}/${marker.repo}`
}

/**
 * Get stats for display in the repo header.
 */
export async function getQuickBrowseStats(repoName) {
  const marker = await readMarker(repoName)
  if (!marker) return null
  return {
    owner: marker.owner,
    repo: marker.repo,
    branch: marker.branch,
    totalFiles: marker.tree.length,
    downloadedCount: Object.keys(marker.downloadedFiles ?? {}).length,
    repoUrl: `https://github.com/${marker.owner}/${marker.repo}`,
  }
}
