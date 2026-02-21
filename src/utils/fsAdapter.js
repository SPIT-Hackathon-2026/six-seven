import * as FileSystem from 'expo-file-system/legacy'
import { Buffer } from 'buffer'

// Polyfill Buffer globally — isomorphic-git (and many Node-oriented libs)
// rely on global.Buffer which doesn't exist in Hermes.
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}

/**
 * Filesystem adapter that bridges expo-file-system to the interface
 * expected by isomorphic-git (Node fs.promises compatible).
 *
 * Key requirements isomorphic-git depends on:
 *  - readFile with no encoding → Uint8Array (binary git objects)
 *  - stat/lstat returning objects with .isFile() / .isDirectory() / .isSymbolicLink()
 *  - mkdir with { recursive } support
 */

// ── helpers ──────────────────────────────────────────────────────────

function wrapStat(info, filepath) {
  const isDir = info.isDirectory === true
  const isFile = !isDir
  return {
    size: Number(info.size ?? 0),
    mode: isDir ? 0o40755 : 0o100644,
    isFile: () => isFile,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    mtimeMs: info.modificationTime ? info.modificationTime * 1000 : Date.now(),
    ctimeMs: info.modificationTime ? info.modificationTime * 1000 : Date.now(),
    uid: 1,
    gid: 1,
    dev: 1,
    ino: 0,
    nlink: 1,
  }
}

function encodeData(data) {
  // Convert Uint8Array/ArrayBuffer to base64
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return { content: btoa(binary), encoding: FileSystem.EncodingType.Base64 }
  }
  return { content: data, encoding: FileSystem.EncodingType.UTF8 }
}

/**
 * Ensure the path is a proper file:// URI that expo-file-system expects.
 * isomorphic-git's internal normalize() collapses file:/// to file:/
 * so we must repair the URI before passing it to FileSystem.
 */
function toUri(filepath) {
  if (typeof filepath !== 'string') return filepath
  // Repair mangled file: URIs (e.g. file:/data/... → file:///data/...)
  if (filepath.startsWith('file:')) {
    const pathPart = filepath.replace(/^file:\/+/, '/')
    return 'file://' + pathPart
  }
  // Plain absolute path → add scheme
  if (filepath.startsWith('/')) {
    return 'file://' + filepath
  }
  return filepath
}

/**
 * Create an error that mimics Node's fs errors with a `.code` property.
 * isomorphic-git relies on `err.code === 'ENOENT'` to detect missing files.
 */
function enoent(syscall, filepath) {
  const err = new Error(
    `ENOENT: no such file or directory, ${syscall} '${filepath}'`,
  )
  err.code = 'ENOENT'
  err.errno = -2
  err.syscall = syscall
  err.path = filepath
  return err
}

/**
 * Safely call FileSystem.getInfoAsync – some expo versions throw
 * instead of returning { exists: false } for certain URI patterns.
 */
async function safeGetInfo(uri, opts) {
  try {
    return await FileSystem.getInfoAsync(uri, opts)
  } catch {
    return { exists: false, isDirectory: false }
  }
}

// ── public fs object ─────────────────────────────────────────────────

export const fs = {
  promises: {
    /**
     * readFile – when encoding is omitted isomorphic-git expects a Uint8Array.
     */
    readFile: async (filepath, options) => {
      const encoding =
        typeof options === 'string' ? options : (options?.encoding ?? null)

      try {
        if (encoding === 'utf8' || encoding === 'utf-8') {
          return await FileSystem.readAsStringAsync(toUri(filepath), {
            encoding: FileSystem.EncodingType.UTF8,
          })
        }

        // Binary read → return Uint8Array
        const base64 = await FileSystem.readAsStringAsync(toUri(filepath), {
          encoding: FileSystem.EncodingType.Base64,
        })
        const binaryStr = atob(base64)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }
        return bytes
      } catch (err) {
        if (err.code === 'ENOENT') throw err
        // Treat any read failure on a missing file as ENOENT
        throw enoent('open', filepath)
      }
    },

    /**
     * writeFile – handle Uint8Array data from isomorphic-git.
     */
    writeFile: async (filepath, data, options) => {
      const { content, encoding: dataEncoding } = encodeData(data)
      let enc = dataEncoding
      if (typeof options === 'string') {
        enc =
          options === 'utf8' || options === 'utf-8'
            ? FileSystem.EncodingType.UTF8
            : options === 'base64'
              ? FileSystem.EncodingType.Base64
              : FileSystem.EncodingType.UTF8
      } else if (options?.encoding) {
        enc =
          options.encoding === 'utf8' || options.encoding === 'utf-8'
            ? FileSystem.EncodingType.UTF8
            : options.encoding === 'base64'
              ? FileSystem.EncodingType.Base64
              : enc
      }
      // Ensure parent directory exists before writing
      const parentUri = toUri(filepath).replace(/\/[^/]+$/, '')
      const parentInfo = await safeGetInfo(parentUri)
      if (!parentInfo.exists) {
        await FileSystem.makeDirectoryAsync(parentUri, { intermediates: true })
      }
      await FileSystem.writeAsStringAsync(toUri(filepath), content, {
        encoding: enc,
      })
    },

    /**
     * unlink – delete a single file.
     */
    unlink: async (filepath) => {
      const info = await safeGetInfo(toUri(filepath))
      if (info.exists) {
        await FileSystem.deleteAsync(toUri(filepath), { idempotent: true })
      }
    },

    /**
     * readdir – return array of entry names.
     */
    readdir: async (dirPath) => {
      try {
        return await FileSystem.readDirectoryAsync(toUri(dirPath))
      } catch (err) {
        if (err.code === 'ENOENT') throw err
        throw enoent('scandir', dirPath)
      }
    },

    /**
     * mkdir – supports { recursive: true }.
     */
    mkdir: async (dirPath, _options) => {
      const info = await safeGetInfo(toUri(dirPath))
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(toUri(dirPath), {
          intermediates: true,
        })
      }
    },

    /**
     * rmdir – recursively remove a directory.
     */
    rmdir: async (dirPath) => {
      const info = await safeGetInfo(toUri(dirPath))
      if (info.exists) {
        await FileSystem.deleteAsync(toUri(dirPath), { idempotent: true })
      }
    },

    /**
     * stat – returns object with .isFile(), .isDirectory(), .isSymbolicLink().
     */
    stat: async (filepath) => {
      const info = await safeGetInfo(toUri(filepath), { size: true })
      if (!info.exists) {
        throw enoent('stat', filepath)
      }
      return wrapStat(info, filepath)
    },

    /**
     * lstat – same as stat on mobile (no real symlinks).
     */
    lstat: async (filepath) => {
      const info = await safeGetInfo(toUri(filepath), { size: true })
      if (!info.exists) {
        throw enoent('lstat', filepath)
      }
      return wrapStat(info, filepath)
    },

    /**
     * readlink / symlink / chmod – stubs for isomorphic-git compatibility.
     */
    readlink: async (filepath) => filepath,
    symlink: async () => {},
    chmod: async () => {},

    /**
     * rename – move/rename a file or directory.
     */
    rename: async (oldPath, newPath) => {
      await FileSystem.moveAsync({
        from: toUri(oldPath),
        to: toUri(newPath),
      })
    },

    /**
     * copyFile
     */
    copyFile: async (src, dest) => {
      await FileSystem.copyAsync({
        from: toUri(src),
        to: toUri(dest),
      })
    },

    /**
     * exists – convenience (not in Node fs.promises but useful).
     */
    exists: async (filepath) => {
      const info = await safeGetInfo(toUri(filepath))
      return info.exists
    },
  },
}
