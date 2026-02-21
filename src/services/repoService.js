import RNFS from 'react-native-fs'
import { REPO_BASE_PATH, ensureRepoBaseExists } from '../utils/path'

// =====================================================================
//  CORE
// =====================================================================

/** Create the folder structure for a new repo. Returns the path. */
export async function createRepoFolder(repoName) {
  await ensureRepoBaseExists()
  const path = `${REPO_BASE_PATH}/${repoName}`
  await RNFS.mkdir(path)
  return path
}

/** List all repo names. */
export async function listRepos() {
  await ensureRepoBaseExists()
  const items = await RNFS.readDir(REPO_BASE_PATH)
  // Only return directories that look like git repos
  const repos = []
  for (const item of items) {
    if (item.isDirectory()) {
      const hasGit = await RNFS.exists(`${item.path}/.git`)
      repos.push({
        name: item.name,
        path: item.path,
        isGitRepo: hasGit,
      })
    }
  }
  return repos
}

/** Get the absolute path for a repo by name. */
export function getRepoPath(repoName) {
  return `${REPO_BASE_PATH}/${repoName}`
}

/** Check if a repo exists. */
export async function repoExists(repoName) {
  const path = getRepoPath(repoName)
  return RNFS.exists(path)
}

// =====================================================================
//  DELETE / RENAME
// =====================================================================

/** Delete a repository and all its contents. */
export async function deleteRepo(repoName) {
  const path = getRepoPath(repoName)
  const exists = await RNFS.exists(path)
  if (exists) {
    await RNFS.unlink(path)
  }
  return true
}

/** Rename a repository folder. */
export async function renameRepo(oldName, newName) {
  const src = getRepoPath(oldName)
  const dest = getRepoPath(newName)
  await RNFS.moveFile(src, dest)
  return dest
}

// =====================================================================
//  SIZE / INFO
// =====================================================================

/**
 * Calculate total repo size in bytes (recursive).
 */
export async function getRepoSize(repoName) {
  const path = getRepoPath(repoName)
  return calculateDirSize(path)
}

async function calculateDirSize(dirPath) {
  let total = 0
  const items = await RNFS.readDir(dirPath)
  for (const item of items) {
    if (item.isDirectory()) {
      total += await calculateDirSize(item.path)
    } else {
      total += Number(item.size ?? 0)
    }
  }
  return total
}

/**
 * Get summary info about a repo.
 */
export async function getRepoInfo(repoName) {
  const path = getRepoPath(repoName)
  const size = await getRepoSize(repoName)
  const hasGit = await RNFS.exists(`${path}/.git`)

  return {
    name: repoName,
    path,
    size,
    sizeFormatted: formatBytes(size),
    isGitRepo: hasGit,
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// =====================================================================
//  EXPORT / IMPORT (zip-like bundle for transfer)
// =====================================================================

/**
 * Export a repo to a single base64-encoded JSON bundle.
 * Useful for cross-device transfer (QR, Bluetooth, etc.).
 */
export async function exportRepoBundle(repoName) {
  const path = getRepoPath(repoName)
  const files = []
  await collectFiles(path, '', files)

  return {
    name: repoName,
    timestamp: Date.now(),
    files, // array of { path, content (base64), isDir }
  }
}

async function collectFiles(basePath, prefix, out) {
  const items = await RNFS.readDir(basePath)
  for (const item of items) {
    const relPath = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isDirectory()) {
      out.push({ path: relPath, content: null, isDir: true })
      await collectFiles(item.path, relPath, out)
    } else {
      const content = await RNFS.readFile(item.path, 'base64')
      out.push({ path: relPath, content, isDir: false })
    }
  }
}

/**
 * Import a repo from a bundle created by exportRepoBundle.
 */
export async function importRepoBundle(bundle) {
  const repoName = bundle.name
  const path = await createRepoFolder(repoName)

  for (const entry of bundle.files) {
    const fullPath = `${path}/${entry.path}`
    if (entry.isDir) {
      await RNFS.mkdir(fullPath)
    } else {
      // Ensure parent dir exists
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      const parentExists = await RNFS.exists(parentDir)
      if (!parentExists) await RNFS.mkdir(parentDir)
      await RNFS.writeFile(fullPath, entry.content, 'base64')
    }
  }

  return path
}
