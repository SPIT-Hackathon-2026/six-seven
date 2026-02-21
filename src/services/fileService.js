import * as FileSystem from 'expo-file-system/legacy'
import { getRepoPath } from './repoService'

// =====================================================================
//  BASIC FILE OPERATIONS
// =====================================================================

/** Write content to a file inside a repo (creates intermediate dirs). */
export async function writeFile(repoName, filePath, content) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  // ensure parent directory exists
  const parentDir = full.substring(0, full.lastIndexOf('/'))
  const info = await FileSystem.getInfoAsync(parentDir)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true })
  }
  await FileSystem.writeAsStringAsync(full, content, {
    encoding: FileSystem.EncodingType.UTF8,
  })
  return full
}

/** Read a file as utf-8 string. */
export async function readFile(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  return FileSystem.readAsStringAsync(full, {
    encoding: FileSystem.EncodingType.UTF8,
  })
}

/** Read a file as base64 (for binary content). */
export async function readFileBase64(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  return FileSystem.readAsStringAsync(full, {
    encoding: FileSystem.EncodingType.Base64,
  })
}

/** Delete a file. */
export async function deleteFile(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  const info = await FileSystem.getInfoAsync(full)
  if (info.exists) {
    await FileSystem.deleteAsync(full, { idempotent: true })
  }
  return true
}

/** Rename / move a file within the repo. */
export async function renameFile(repoName, oldPath, newPath) {
  const src = `${getRepoPath(repoName)}/${oldPath}`
  const dest = `${getRepoPath(repoName)}/${newPath}`
  const parentDir = dest.substring(0, dest.lastIndexOf('/'))
  const parentInfo = await FileSystem.getInfoAsync(parentDir)
  if (!parentInfo.exists) {
    await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true })
  }
  await FileSystem.moveAsync({ from: src, to: dest })
  return true
}

/** Copy a file within the repo. */
export async function copyFile(repoName, srcPath, destPath) {
  const src = `${getRepoPath(repoName)}/${srcPath}`
  const dest = `${getRepoPath(repoName)}/${destPath}`
  await FileSystem.copyAsync({ from: src, to: dest })
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

  const names = await FileSystem.readDirectoryAsync(dirPath)

  const items = []
  for (const name of names) {
    if (name === '.git') continue
    const fullPath = `${dirPath}/${name}`
    const info = await FileSystem.getInfoAsync(fullPath, { size: true })
    items.push({
      name,
      path: fullPath,
      isDirectory: info.isDirectory === true,
      size: Number(info.size ?? 0),
      mtime: info.modificationTime
        ? new Date(info.modificationTime * 1000)
        : null,
    })
  }

  return items
}

/** Recursively list all files in the repo (relative paths). */
export async function listFilesRecursive(repoName, subDir = '') {
  const root = getRepoPath(repoName)
  const results = []

  async function walk(dir, prefix) {
    const names = await FileSystem.readDirectoryAsync(dir)
    for (const name of names) {
      if (name === '.git') continue
      const fullPath = `${dir}/${name}`
      const relPath = prefix ? `${prefix}/${name}` : name
      const info = await FileSystem.getInfoAsync(fullPath, { size: true })
      if (info.isDirectory) {
        await walk(fullPath, relPath)
      } else {
        results.push({
          name,
          path: relPath,
          size: Number(info.size ?? 0),
          mtime: info.modificationTime
            ? new Date(info.modificationTime * 1000)
            : null,
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
  await FileSystem.makeDirectoryAsync(full, { intermediates: true })
  return full
}

/** Delete a directory recursively. */
export async function deleteDirectory(repoName, dirPath) {
  const full = `${getRepoPath(repoName)}/${dirPath}`
  const info = await FileSystem.getInfoAsync(full)
  if (info.exists) {
    await FileSystem.deleteAsync(full, { idempotent: true })
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
      const content = await FileSystem.readAsStringAsync(fullPath, {
        encoding: FileSystem.EncodingType.UTF8,
      })
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
  const info = await FileSystem.getInfoAsync(full, { size: true })
  return {
    size: Number(info.size ?? 0),
    mtime: info.modificationTime
      ? new Date(info.modificationTime * 1000)
      : null,
    ctime: null, // expo-file-system doesn't expose ctime
    isDirectory: info.isDirectory === true,
  }
}

/** Check if a file exists. */
export async function fileExists(repoName, filePath) {
  const full = `${getRepoPath(repoName)}/${filePath}`
  const info = await FileSystem.getInfoAsync(full)
  return info.exists
}
