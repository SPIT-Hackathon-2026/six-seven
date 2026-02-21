import RNFS from 'react-native-fs'
import { getRepoPath } from './repoService'

// =====================================================================
//  BASIC FILE OPERATIONS
// =====================================================================

/** Write content to a file inside a repo (creates intermediate dirs). */
export async function writeFile(repoName, filePath, content) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  // ensure parent directory exists
  const parentDir = full.substring(0, full.lastIndexOf('/'))
  const exists = await RNFS.exists(parentDir)
  if (!exists) {
    await RNFS.mkdir(parentDir)
  }
  await RNFS.writeFile(full, content, 'utf8')
  return full
}

/** Read a file as utf-8 string. */
export async function readFile(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  return RNFS.readFile(full, 'utf8')
}

/** Read a file as base64 (for binary content). */
export async function readFileBase64(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  return RNFS.readFile(full, 'base64')
}

/** Delete a file. */
export async function deleteFile(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  const exists = await RNFS.exists(full)
  if (exists) {
    await RNFS.unlink(full)
  }
  return true
}

/** Rename / move a file within the repo. */
export async function renameFile(repoName, oldPath, newPath) {
  const src = `${getRepoPath(repoName)}/${oldPath}`
  const dest = `${getRepoPath(repoName)}/${newPath}`
  const parentDir = dest.substring(0, dest.lastIndexOf('/'))
  const parentExists = await RNFS.exists(parentDir)
  if (!parentExists) {
    await RNFS.mkdir(parentDir)
  }
  await RNFS.moveFile(src, dest)
  return true
}

/** Copy a file within the repo. */
export async function copyFile(repoName, srcPath, destPath) {
  const src = `${getRepoPath(repoName)}/${srcPath}`
  const dest = `${getRepoPath(repoName)}/${destPath}`
  await RNFS.copyFile(src, dest)
  return true
}

// =====================================================================
//  DIRECTORY LISTING
// =====================================================================

/** List immediate children of a directory (non-recursive), excluding .git. */
export async function listFiles(repoName, subDir = '') {
  const dirPath = subDir
    ? `${getRepoPath(repoName)}/${subDir}`
    : getRepoPath(repoName)

  const items = await RNFS.readDir(dirPath)

  return items
    .filter((f) => f.name !== '.git')
    .map((f) => ({
      name: f.name,
      path: f.path,
      isDirectory: f.isDirectory(),
      size: Number(f.size ?? 0),
      mtime: f.mtime,
    }))
}

/** Recursively list all files in the repo (relative paths). */
export async function listFilesRecursive(repoName, subDir = '') {
  const root = getRepoPath(repoName)
  const results = []

  async function walk(dir, prefix) {
    const items = await RNFS.readDir(dir)
    for (const item of items) {
      if (item.name === '.git') continue
      const relPath = prefix ? `${prefix}/${item.name}` : item.name
      if (item.isDirectory()) {
        await walk(item.path, relPath)
      } else {
        results.push({
          name: item.name,
          path: relPath,
          size: Number(item.size ?? 0),
          mtime: item.mtime,
        })
      }
    }
  }

  const startDir = subDir ? `${root}/${subDir}` : root
  await walk(startDir, subDir)
  return results
}

// =====================================================================
//  DIRECTORY OPERATIONS
// =====================================================================

/** Create a directory inside the repo. */
export async function createDirectory(repoName, dirPath) {
  const full = `${getRepoPath(repoName)}/${dirPath}`
  await RNFS.mkdir(full)
  return full
}

/** Delete a directory recursively. */
export async function deleteDirectory(repoName, dirPath) {
  const full = `${getRepoPath(repoName)}/${dirPath}`
  const exists = await RNFS.exists(full)
  if (exists) {
    await RNFS.unlink(full) // RNFS.unlink removes dirs recursively on Android
  }
  return true
}

// =====================================================================
//  SEARCH
// =====================================================================

/**
 * Search for files whose name contains the query string (case-insensitive).
 */
export async function searchFiles(repoName, query) {
  const allFiles = await listFilesRecursive(repoName)
  const lower = query.toLowerCase()
  return allFiles.filter((f) => f.name.toLowerCase().includes(lower))
}

/**
 * Search for content across all files (simple grep-like).
 * Returns array of { path, line, content } matches.
 */
export async function searchContent(repoName, query, options = {}) {
  const allFiles = await listFilesRecursive(repoName)
  const matches = []
  const maxResults = options.maxResults ?? 200
  const lowerQuery = query.toLowerCase()

  for (const file of allFiles) {
    if (matches.length >= maxResults) break
    try {
      const fullPath = `${getRepoPath(repoName)}/${file.path}`
      const content = await RNFS.readFile(fullPath, 'utf8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          matches.push({
            path: file.path,
            line: i + 1,
            content: lines[i].trim(),
          })
          if (matches.length >= maxResults) break
        }
      }
    } catch {
      // skip binary / unreadable files
    }
  }

  return matches
}

// =====================================================================
//  FILE INFO
// =====================================================================

/** Get stat info for a file. */
export async function getFileInfo(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  const stat = await RNFS.stat(full)
  return {
    size: Number(stat.size ?? 0),
    mtime: stat.mtime,
    ctime: stat.ctime,
    isDirectory: stat.isDirectory ? stat.isDirectory() : false,
  }
}

/** Check if a file exists. */
export async function fileExists(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  return RNFS.exists(full)
}
