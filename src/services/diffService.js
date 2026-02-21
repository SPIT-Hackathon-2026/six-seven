/**
 * diffService.js
 *
 * Line-level diff engine and semantic merge helpers.
 * Works fully offline – no network calls.
 */

// =====================================================================
//  LINE-LEVEL DIFF  (Myers / LCS based)
// =====================================================================

/**
 * Compute the diff between two strings (line-by-line).
 * Returns an array of { type, value } where type is 'add' | 'remove' | 'equal'.
 */
export function diffLines(oldText, newText) {
  const oldLines = (oldText ?? '').split('\n')
  const newLines = (newText ?? '').split('\n')
  const result = []

  const lcs = longestCommonSubsequence(oldLines, newLines)
  let oi = 0
  let ni = 0
  let li = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (
      li < lcs.length &&
      oi < oldLines.length &&
      oldLines[oi] === lcs[li] &&
      ni < newLines.length &&
      newLines[ni] === lcs[li]
    ) {
      result.push({
        type: 'equal',
        value: lcs[li],
        oldLine: oi + 1,
        newLine: ni + 1,
      })
      oi++
      ni++
      li++
    } else if (
      ni < newLines.length &&
      (li >= lcs.length || newLines[ni] !== lcs[li])
    ) {
      result.push({ type: 'add', value: newLines[ni], newLine: ni + 1 })
      ni++
    } else if (
      oi < oldLines.length &&
      (li >= lcs.length || oldLines[oi] !== lcs[li])
    ) {
      result.push({ type: 'remove', value: oldLines[oi], oldLine: oi + 1 })
      oi++
    }
  }

  return result
}

/**
 * Generate a unified-diff-style string.
 */
export function unifiedDiff(oldText, newText, options = {}) {
  const { oldName = 'a', newName = 'b', context = 3 } = options
  const diffs = diffLines(oldText, newText)

  let output = `--- ${oldName}\n+++ ${newName}\n`
  let hunkStart = -1
  const hunkLines = []

  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i]
    if (d.type !== 'equal') {
      // Include context lines before
      const start = Math.max(0, i - context)
      if (hunkStart === -1) hunkStart = start
      // flush up to context lines after last change
      const end = Math.min(diffs.length - 1, i + context)
      for (let j = hunkStart; j <= end; j++) {
        if (!hunkLines.includes(j)) hunkLines.push(j)
      }
      hunkStart = Math.max(hunkStart, end + 1)
    }
  }

  for (const idx of hunkLines) {
    const d = diffs[idx]
    if (d.type === 'equal') output += ` ${d.value}\n`
    else if (d.type === 'add') output += `+${d.value}\n`
    else if (d.type === 'remove') output += `-${d.value}\n`
  }

  return output
}

// =====================================================================
//  THREE-WAY MERGE
// =====================================================================

/**
 * Perform a three-way merge of text content.
 *
 * @param {string} base    – common ancestor
 * @param {string} ours    – our version
 * @param {string} theirs  – their version
 * @returns {{ merged: string, hasConflicts: boolean, conflicts: Array }}
 */
export function threeWayMerge(base, ours, theirs) {
  const baseLines = (base ?? '').split('\n')
  const ourLines = (ours ?? '').split('\n')
  const theirLines = (theirs ?? '').split('\n')

  // We use a simple line-by-line comparison strategy:
  // Walk base/ours/theirs simultaneously and detect divergence.

  const merged = []
  const conflicts = []
  let hasConflicts = false

  let bi = 0,
    oi = 0,
    ti = 0

  while (
    bi < baseLines.length ||
    oi < ourLines.length ||
    ti < theirLines.length
  ) {
    const baseLine = bi < baseLines.length ? baseLines[bi] : undefined
    const ourLine = oi < ourLines.length ? ourLines[oi] : undefined
    const theirLine = ti < theirLines.length ? theirLines[ti] : undefined

    if (baseLine === ourLine && baseLine === theirLine) {
      // No changes
      merged.push(baseLine)
      bi++
      oi++
      ti++
    } else if (baseLine === ourLine && baseLine !== theirLine) {
      // Theirs changed
      if (theirLine !== undefined) merged.push(theirLine)
      bi++
      oi++
      ti++
    } else if (baseLine !== ourLine && baseLine === theirLine) {
      // Ours changed
      if (ourLine !== undefined) merged.push(ourLine)
      bi++
      oi++
      ti++
    } else if (ourLine === theirLine) {
      // Both changed identically
      if (ourLine !== undefined) merged.push(ourLine)
      bi++
      oi++
      ti++
    } else {
      // Real conflict
      hasConflicts = true
      const conflictBlock = {
        line: merged.length + 1,
        base: baseLine ?? '',
        ours: ourLine ?? '',
        theirs: theirLine ?? '',
      }
      conflicts.push(conflictBlock)

      // Write conflict markers
      merged.push('<<<<<<< ours')
      if (ourLine !== undefined) merged.push(ourLine)
      merged.push('=======')
      if (theirLine !== undefined) merged.push(theirLine)
      merged.push('>>>>>>> theirs')
      bi++
      oi++
      ti++
    }
  }

  return {
    merged: merged.join('\n'),
    hasConflicts,
    conflicts,
  }
}

/**
 * Auto-resolve a merge: if no conflicts, return the merged content.
 * If conflicts exist, return the content with conflict markers and the list.
 */
export function autoMerge(base, ours, theirs) {
  return threeWayMerge(base, ours, theirs)
}

// =====================================================================
//  HUNK-BASED DIFF (for UI rendering)
// =====================================================================

/**
 * Produce diff hunks suitable for mobile UI display.
 * Each hunk = { startOld, startNew, lines: [{ type, value }] }
 */
export function diffHunks(oldText, newText, contextLines = 3) {
  const diffs = diffLines(oldText, newText)
  const hunks = []
  let currentHunk = null

  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i]
    if (d.type !== 'equal') {
      if (!currentHunk) {
        currentHunk = {
          startOld: d.oldLine ?? d.newLine,
          startNew: d.newLine ?? d.oldLine,
          lines: [],
        }
        // Add context before
        for (let j = Math.max(0, i - contextLines); j < i; j++) {
          currentHunk.lines.push(diffs[j])
        }
      }
      currentHunk.lines.push(d)
    } else if (currentHunk) {
      currentHunk.lines.push(d)
      // Check if we're past context window
      const nextChangeIdx = diffs.findIndex(
        (dd, ii) => ii > i && dd.type !== 'equal',
      )
      if (nextChangeIdx === -1 || nextChangeIdx - i > contextLines * 2) {
        // End hunk after trailing context
        hunks.push(currentHunk)
        currentHunk = null
      }
    }
  }

  if (currentHunk) hunks.push(currentHunk)
  return hunks
}

// =====================================================================
//  HELPERS
// =====================================================================

function longestCommonSubsequence(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack
  const result = []
  let i = m,
    j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return result
}

/** Compute diff between two arrays of lines. */
export function diffArrays(oldArr, newArr) {
  const lcs = longestCommonSubsequence(oldArr, newArr)
  const result = []
  let oi = 0,
    ni = 0,
    li = 0

  while (oi < oldArr.length || ni < newArr.length) {
    if (
      li < lcs.length &&
      oi < oldArr.length &&
      oldArr[oi] === lcs[li] &&
      ni < newArr.length &&
      newArr[ni] === lcs[li]
    ) {
      result.push({ type: 'equal', value: lcs[li] })
      oi++
      ni++
      li++
    } else if (
      ni < newArr.length &&
      (li >= lcs.length || newArr[ni] !== lcs[li])
    ) {
      result.push({ type: 'add', value: newArr[ni] })
      ni++
    } else if (
      oi < oldArr.length &&
      (li >= lcs.length || oldArr[oi] !== lcs[li])
    ) {
      result.push({ type: 'remove', value: oldArr[oi] })
      oi++
    }
  }

  return result
}
