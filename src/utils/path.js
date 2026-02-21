import RNFS from 'react-native-fs'

// =====================================================================
//  BASE PATHS
// =====================================================================

/** Root directory for all repos. */
export const REPO_BASE_PATH = RNFS.DocumentDirectoryPath + '/repos'

/** Temp directory for transfers / staging. */
export const TEMP_PATH = RNFS.CachesDirectoryPath + '/git-temp'

/** Ensure the base repos directory exists. */
export async function ensureRepoBaseExists() {
  const exists = await RNFS.exists(REPO_BASE_PATH)
  if (!exists) {
    await RNFS.mkdir(REPO_BASE_PATH)
  }
}

/** Ensure the temp directory exists. */
export async function ensureTempExists() {
  const exists = await RNFS.exists(TEMP_PATH)
  if (!exists) {
    await RNFS.mkdir(TEMP_PATH)
  }
}

// =====================================================================
//  PATH UTILITIES
// =====================================================================

/** Normalize a path – remove double slashes, trailing slashes. */
export function normalizePath(p) {
  return p.replace(/\/+/g, '/').replace(/\/$/, '')
}

/** Join path segments. */
export function joinPath(...segments) {
  return normalizePath(segments.join('/'))
}

/** Get the file name from a path. */
export function basename(p) {
  const parts = normalizePath(p).split('/')
  return parts[parts.length - 1] || ''
}

/** Get the directory part of a path. */
export function dirname(p) {
  const normalized = normalizePath(p)
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return '/'
  return normalized.substring(0, idx)
}

/** Get file extension (without dot). */
export function extname(p) {
  const name = basename(p)
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.substring(idx + 1)
}

/** Check if a path is absolute. */
export function isAbsolute(p) {
  return p.startsWith('/')
}

/**
 * Get the relative path from `from` to `to`.
 */
export function relativePath(from, to) {
  const fromParts = normalizePath(from).split('/').filter(Boolean)
  const toParts = normalizePath(to).split('/').filter(Boolean)

  let common = 0
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++
  }

  const ups = fromParts.length - common
  const remaining = toParts.slice(common)
  const parts = [...Array(ups).fill('..'), ...remaining]
  return parts.join('/') || '.'
}

// =====================================================================
//  SAFE FILE HELPERS
// =====================================================================

/** Recursively ensure a directory path exists. */
export async function mkdirp(dirPath) {
  const exists = await RNFS.exists(dirPath)
  if (!exists) {
    await RNFS.mkdir(dirPath)
  }
}

/** Get available disk space (Android/iOS). */
export async function getFreeDiskSpace() {
  try {
    const space = await RNFS.getFSInfo()
    return {
      free: space.freeSpace,
      total: space.totalSpace,
      freeFormatted: formatBytes(space.freeSpace),
      totalFormatted: formatBytes(space.totalSpace),
    }
  } catch {
    return { free: 0, total: 0, freeFormatted: 'N/A', totalFormatted: 'N/A' }
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
