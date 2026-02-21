import RNFS from 'react-native-fs'

/**
 * Filesystem adapter that bridges react-native-fs to the interface
 * expected by isomorphic-git (Node fs.promises compatible).
 *
 * Key requirements isomorphic-git depends on:
 *  - readFile with no encoding → Uint8Array (binary git objects)
 *  - stat/lstat returning objects with .isFile() / .isDirectory() / .isSymbolicLink()
 *  - mkdir with { recursive } support
 */

// ── helpers ──────────────────────────────────────────────────────────

function wrapStat(raw) {
  const isDir = raw.isDirectory
    ? raw.isDirectory()
    : raw.type === 'directory' || raw.type === 1
  const isFile = raw.isFile
    ? raw.isFile()
    : raw.type === 'file' || raw.type === 0
  return {
    ...raw,
    size: Number(raw.size ?? 0),
    mode: isDir ? 0o40755 : 0o100644,
    isFile: () => isFile,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    mtimeMs: raw.mtime ? new Date(raw.mtime).getTime() : Date.now(),
    ctimeMs: raw.ctime ? new Date(raw.ctime).getTime() : Date.now(),
  }
}

async function encode(data) {
  // Convert Uint8Array/ArrayBuffer to base64 for RNFS
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return { content: btoa(binary), encoding: 'base64' }
  }
  return { content: data, encoding: 'utf8' }
}

async function mkdirp(dirPath) {
  const exists = await RNFS.exists(dirPath)
  if (!exists) {
    await RNFS.mkdir(dirPath, { NSURLIsExcludedFromBackupKey: false })
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

      if (encoding === 'utf8' || encoding === 'utf-8') {
        return RNFS.readFile(filepath, 'utf8')
      }

      // Binary read → return Uint8Array
      const base64 = await RNFS.readFile(filepath, 'base64')
      const binaryStr = atob(base64)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
      }
      return bytes
    },

    /**
     * writeFile – handle Uint8Array data from isomorphic-git.
     */
    writeFile: async (filepath, data, options) => {
      const { content, encoding } = await encode(data)
      const enc =
        typeof options === 'string' ? options : (options?.encoding ?? encoding)
      await RNFS.writeFile(filepath, content, enc)
    },

    /**
     * unlink – delete a single file.
     */
    unlink: async (filepath) => {
      const exists = await RNFS.exists(filepath)
      if (exists) await RNFS.unlink(filepath)
    },

    /**
     * readdir – return array of entry names.
     */
    readdir: async (dirPath) => {
      const items = await RNFS.readDir(dirPath)
      return items.map((item) => item.name)
    },

    /**
     * mkdir – supports { recursive: true }.
     */
    mkdir: async (dirPath, options) => {
      if (options?.recursive || options?.recursive === undefined) {
        await mkdirp(dirPath)
      } else {
        await RNFS.mkdir(dirPath)
      }
    },

    /**
     * rmdir – recursively remove a directory.
     */
    rmdir: async (dirPath) => {
      const exists = await RNFS.exists(dirPath)
      if (exists) {
        // RNFS.unlink on Android removes directories recursively
        await RNFS.unlink(dirPath)
      }
    },

    /**
     * stat – returns object with .isFile(), .isDirectory(), .isSymbolicLink().
     */
    stat: async (filepath) => {
      const raw = await RNFS.stat(filepath)
      return wrapStat(raw)
    },

    /**
     * lstat – same as stat on mobile (no real symlinks).
     */
    lstat: async (filepath) => {
      const raw = await RNFS.stat(filepath)
      return wrapStat(raw)
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
      await RNFS.moveFile(oldPath, newPath)
    },

    /**
     * copyFile
     */
    copyFile: async (src, dest) => {
      await RNFS.copyFile(src, dest)
    },

    /**
     * exists – convenience (not in Node fs.promises but useful).
     */
    exists: async (filepath) => {
      return RNFS.exists(filepath)
    },
  },
}
