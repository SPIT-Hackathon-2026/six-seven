import * as FileSystem from 'expo-file-system/legacy'
import { REPO_BASE_PATH, ensureRepoBaseExists } from '../utils/path'

// =====================================================================
//  CORE
// =====================================================================

/** Create the folder structure for a new repo. Returns the path. */
export async function createRepoFolder(repoName) {
  await ensureRepoBaseExists()
  const path = `${REPO_BASE_PATH}/${repoName}`
  await FileSystem.makeDirectoryAsync(path, { intermediates: true })
  return path
}

/** List all repo names. */
export async function listRepos() {
  await ensureRepoBaseExists()
  const names = await FileSystem.readDirectoryAsync(REPO_BASE_PATH)
  const repos = []
  for (const name of names) {
    const itemPath = `${REPO_BASE_PATH}/${name}`
    const info = await FileSystem.getInfoAsync(itemPath)
    if (info.isDirectory) {
      const gitInfo = await FileSystem.getInfoAsync(`${itemPath}/.git`)
      repos.push({
        name,
        path: itemPath,
        isGitRepo: gitInfo.exists,
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
  const info = await FileSystem.getInfoAsync(path)
  return info.exists
}

// =====================================================================
//  DELETE / RENAME
// =====================================================================

/** Delete a repository and all its contents. */
export async function deleteRepo(repoName) {
  const path = getRepoPath(repoName)
  const info = await FileSystem.getInfoAsync(path)
  if (info.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true })
  }
  return true
}

/** Rename a repository folder. */
export async function renameRepo(oldName, newName) {
  const src = getRepoPath(oldName)
  const dest = getRepoPath(newName)
  await FileSystem.moveAsync({ from: src, to: dest })
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
  const names = await FileSystem.readDirectoryAsync(dirPath)
  for (const name of names) {
    const fullPath = `${dirPath}/${name}`
    const info = await FileSystem.getInfoAsync(fullPath, { size: true })
    if (info.isDirectory) {
      total += await calculateDirSize(fullPath)
    } else {
      total += Number(info.size ?? 0)
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
  const gitInfo = await FileSystem.getInfoAsync(`${path}/.git`)

  return {
    name: repoName,
    path,
    size,
    sizeFormatted: formatBytes(size),
    isGitRepo: gitInfo.exists,
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
  const names = await FileSystem.readDirectoryAsync(basePath)
  for (const name of names) {
    const fullPath = `${basePath}/${name}`
    const relPath = prefix ? `${prefix}/${name}` : name
    const info = await FileSystem.getInfoAsync(fullPath)
    if (info.isDirectory) {
      out.push({ path: relPath, content: null, isDir: true })
      await collectFiles(fullPath, relPath, out)
    } else {
      const content = await FileSystem.readAsStringAsync(fullPath, {
        encoding: FileSystem.EncodingType.Base64,
      })
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
      await FileSystem.makeDirectoryAsync(fullPath, { intermediates: true })
    } else {
      // Ensure parent dir exists
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      const parentInfo = await FileSystem.getInfoAsync(parentDir)
      if (!parentInfo.exists) {
        await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true })
      }
      await FileSystem.writeAsStringAsync(fullPath, entry.content, {
        encoding: FileSystem.EncodingType.Base64,
      })
    }
  }

  return path
}
