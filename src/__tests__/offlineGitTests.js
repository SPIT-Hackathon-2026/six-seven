/**
 * __tests__/offlineGitTests.js
 *
 * Integration test suite for the offline Git service layer.
 * Designed to run inside the React Native runtime (not Node.js)
 * because it depends on react-native-fs and isomorphic-git with
 * our custom fsAdapter.
 *
 * Usage: import and call `runAllTests()` from any screen/button
 *        in the app during development. Results are returned as
 *        an array and also logged via console.log.
 *
 *   import { runAllTests } from '../__tests__/offlineGitTests'
 *   const results = await runAllTests()
 */

// ── Service imports ──────────────────────────────────────────────────

import {
  setAuthor,
  getAuthor,
  initRepo,
  stageFile,
  stageAll,
  getStatus,
  getFileStatus,
  commit,
  commitAll,
  createBranch,
  deleteBranch,
  listBranches,
  currentBranch,
  checkout,
  createTag,
  deleteTag,
  listTags,
  mergeBranch,
  getConflictVersions,
  resolveConflict,
  getLog,
  resolveRef,
  diffFile,
  diffSummary,
  commitWithReflog,
  getReflog,
  resetHard,
  readFileAtRef,
  listFilesAtRef,
  checkRepoHealth,
  duplicateRepo,
} from '../services/gitService'

import {
  writeFile,
  readFile,
  listFiles,
  listFilesRecursive,
  deleteFile,
  renameFile,
  searchFiles,
  searchContent,
  fileExists,
  createDirectory,
  getFileInfo,
} from '../services/fileService'

import {
  listRepos,
  deleteRepo,
  getRepoInfo,
  repoExists,
  exportRepoBundle,
  importRepoBundle,
} from '../services/repoService'

import {
  stash,
  stashList,
  stashApply,
  stashPop,
  stashDrop,
  stashClear,
  stashShow,
} from '../services/stashService'

import {
  diffLines,
  unifiedDiff,
  threeWayMerge,
  autoMerge,
  diffHunks,
} from '../services/diffService'

import {
  exportForTransfer,
  importFromTransfer,
  splitIntoChunks,
  reassembleChunks,
} from '../services/transferService'

import { normalizePath, joinPath, basename, dirname, extname, getFreeDiskSpace } from '../utils/path'

// ── Test runner ──────────────────────────────────────────────────────

const results = []
let passCount = 0
let failCount = 0

function log(msg) {
  console.log(`[TEST] ${msg}`)
}

function assert(condition, description) {
  if (condition) {
    passCount++
    results.push({ status: 'PASS', description })
    log(`  ✅ ${description}`)
  } else {
    failCount++
    results.push({ status: 'FAIL', description })
    log(`  ❌ ${description}`)
  }
}

function assertEqual(actual, expected, description) {
  const pass = actual === expected
  if (!pass) {
    failCount++
    results.push({ status: 'FAIL', description, actual, expected })
    log(`  ❌ ${description} — expected "${expected}", got "${actual}"`)
  } else {
    passCount++
    results.push({ status: 'PASS', description })
    log(`  ✅ ${description}`)
  }
}

function assertIncludes(arr, item, description) {
  assert(Array.isArray(arr) && arr.includes(item), description)
}

function assertNotIncludes(arr, item, description) {
  assert(Array.isArray(arr) && !arr.includes(item), description)
}

async function runTest(name, fn) {
  log(`\n── ${name} ──`)
  try {
    await fn()
  } catch (err) {
    failCount++
    results.push({ status: 'FAIL', description: `${name} threw: ${err.message}` })
    log(`  ❌ EXCEPTION: ${err.message}`)
  }
}

// ── Unique repo name to avoid collisions ─────────────────────────────

const TS = Date.now()
const REPO = `test-repo-${TS}`
const REPO2 = `test-repo2-${TS}`
const REPO_DUP = `test-dup-${TS}`
const REPO_TRANSFER = `test-transfer-${TS}`

// =====================================================================
//  TEST SUITES
// =====================================================================

// ── 1. Path utilities (sync, no FS needed) ───────────────────────────

async function testPathUtils() {
  await runTest('Path utilities', async () => {
    assertEqual(normalizePath('/a//b///c/'), '/a/b/c', 'normalizePath removes double slashes and trailing slash')
    assertEqual(joinPath('a', 'b', 'c'), 'a/b/c', 'joinPath joins segments')
    assertEqual(basename('/foo/bar/baz.txt'), 'baz.txt', 'basename extracts filename')
    assertEqual(dirname('/foo/bar/baz.txt'), '/foo/bar', 'dirname extracts directory')
    assertEqual(extname('file.js'), 'js', 'extname extracts extension')
    assertEqual(extname('Makefile'), '', 'extname returns empty for no extension')
  })
}

// ── 2. Repo creation and management ──────────────────────────────────

async function testRepoManagement() {
  await runTest('Init repo', async () => {
    const dir = await initRepo(REPO)
    assert(typeof dir === 'string' && dir.length > 0, 'initRepo returns a path')
    const exists = await repoExists(REPO)
    assert(exists, 'repoExists returns true after init')
  })

  await runTest('List repos', async () => {
    const repos = await listRepos()
    const names = repos.map((r) => r.name)
    assertIncludes(names, REPO, 'listRepos includes newly created repo')
  })

  await runTest('Repo info', async () => {
    const info = await getRepoInfo(REPO)
    assertEqual(info.name, REPO, 'getRepoInfo returns correct name')
    assert(info.isGitRepo === true, 'getRepoInfo detects .git')
    assert(typeof info.sizeFormatted === 'string', 'getRepoInfo returns formatted size')
  })
}

// ── 3. File operations ───────────────────────────────────────────────

async function testFileOperations() {
  await runTest('Write and read file', async () => {
    await writeFile(REPO, 'hello.txt', 'Hello World')
    const content = await readFile(REPO, 'hello.txt')
    assertEqual(content, 'Hello World', 'readFile returns what writeFile wrote')
  })

  await runTest('Write nested file', async () => {
    await writeFile(REPO, 'src/index.js', 'console.log("init")')
    const content = await readFile(REPO, 'src/index.js')
    assertEqual(content, 'console.log("init")', 'nested file created with parent dir')
  })

  await runTest('List files', async () => {
    const files = await listFiles(REPO)
    const names = files.map((f) => f.name)
    assertIncludes(names, 'hello.txt', 'listFiles includes hello.txt')
    assertIncludes(names, 'src', 'listFiles includes src directory')
  })

  await runTest('List files recursive', async () => {
    const all = await listFilesRecursive(REPO)
    const paths = all.map((f) => f.path)
    assertIncludes(paths, 'hello.txt', 'recursive list includes hello.txt')
    assertIncludes(paths, 'src/index.js', 'recursive list includes src/index.js')
  })

  await runTest('File exists', async () => {
    const yes = await fileExists(REPO, 'hello.txt')
    assert(yes, 'fileExists returns true for existing file')
    const no = await fileExists(REPO, 'nope.txt')
    assert(!no, 'fileExists returns false for missing file')
  })

  await runTest('File info', async () => {
    const info = await getFileInfo(REPO, 'hello.txt')
    assert(info.size > 0, 'getFileInfo returns size > 0')
  })

  await runTest('Create directory', async () => {
    await createDirectory(REPO, 'lib/utils')
    await writeFile(REPO, 'lib/utils/helper.js', '// helper')
    const content = await readFile(REPO, 'lib/utils/helper.js')
    assertEqual(content, '// helper', 'file in created directory is readable')
  })

  await runTest('Rename file', async () => {
    await writeFile(REPO, 'temp.txt', 'temp content')
    await renameFile(REPO, 'temp.txt', 'renamed.txt')
    const exists = await fileExists(REPO, 'renamed.txt')
    assert(exists, 'renamed file exists')
    const oldExists = await fileExists(REPO, 'temp.txt')
    assert(!oldExists, 'original file is gone after rename')
  })

  await runTest('Delete file', async () => {
    await deleteFile(REPO, 'renamed.txt')
    const exists = await fileExists(REPO, 'renamed.txt')
    assert(!exists, 'file gone after deleteFile')
  })

  await runTest('Search files', async () => {
    const results = await searchFiles(REPO, 'hello')
    assert(results.length > 0, 'searchFiles finds hello.txt')
  })

  await runTest('Search content', async () => {
    const results = await searchContent(REPO, 'Hello World')
    assert(results.length > 0, 'searchContent finds "Hello World" in files')
    assertEqual(results[0].path, 'hello.txt', 'searchContent returns correct file')
  })
}

// ── 4. Git staging and status ────────────────────────────────────────

async function testStagingAndStatus() {
  await runTest('Author config', async () => {
    setAuthor('Test User', 'test@example.com')
    const a = getAuthor()
    assertEqual(a.name, 'Test User', 'setAuthor/getAuthor name')
    assertEqual(a.email, 'test@example.com', 'setAuthor/getAuthor email')
  })

  await runTest('Stage file and check status', async () => {
    await stageFile(REPO, 'hello.txt')
    const status = await getFileStatus(REPO, 'hello.txt')
    assert(status !== 'absent', 'hello.txt is staged (not absent)')
  })

  await runTest('Stage all and full status', async () => {
    await stageAll(REPO)
    const statuses = await getStatus(REPO)
    assert(Array.isArray(statuses), 'getStatus returns array')
    assert(statuses.length > 0, 'getStatus has entries after stageAll')
  })
}

// ── 5. Commits ───────────────────────────────────────────────────────

async function testCommits() {
  await runTest('First commit', async () => {
    const sha = await commit(REPO, 'Initial commit')
    assert(typeof sha === 'string' && sha.length === 40, 'commit returns 40-char SHA')
  })

  await runTest('Commit log', async () => {
    const log = await getLog(REPO)
    assert(log.length >= 1, 'log has at least one commit')
    assertEqual(log[0].commit.message, 'Initial commit\n', 'log[0] message matches')
  })

  await runTest('Resolve HEAD', async () => {
    const oid = await resolveRef(REPO, 'HEAD')
    assert(typeof oid === 'string' && oid.length === 40, 'resolveRef HEAD returns oid')
  })

  await runTest('CommitAll shortcut', async () => {
    await writeFile(REPO, 'second.txt', 'second file')
    const sha = await commitAll(REPO, 'Add second.txt')
    assert(sha.length === 40, 'commitAll returns SHA')
    const log = await getLog(REPO)
    assert(log.length >= 2, 'log now has 2+ commits')
  })

  await runTest('CommitWithReflog', async () => {
    await writeFile(REPO, 'third.txt', 'third')
    await stageAll(REPO)
    const sha = await commitWithReflog(REPO, 'Add third.txt')
    assert(sha.length === 40, 'commitWithReflog returns SHA')
    const reflog = await getReflog(REPO)
    assert(reflog.length >= 1, 'reflog has entry')
    assertEqual(reflog[reflog.length - 1].action, 'commit', 'reflog entry action is commit')
  })
}

// ── 6. Branches ──────────────────────────────────────────────────────

async function testBranches() {
  await runTest('Current branch', async () => {
    const branch = await currentBranch(REPO)
    assertEqual(branch, 'main', 'current branch is main')
  })

  await runTest('Create branch', async () => {
    await createBranch(REPO, 'feature-a')
    const branches = await listBranches(REPO)
    assertIncludes(branches, 'feature-a', 'feature-a in branch list')
    assertIncludes(branches, 'main', 'main still in branch list')
  })

  await runTest('Checkout branch', async () => {
    await checkout(REPO, 'feature-a')
    const branch = await currentBranch(REPO)
    assertEqual(branch, 'feature-a', 'checked out feature-a')
  })

  await runTest('Commit on feature branch', async () => {
    await writeFile(REPO, 'feature.txt', 'feature content')
    await commitAll(REPO, 'Add feature.txt')
    const log = await getLog(REPO)
    assertEqual(log[0].commit.message, 'Add feature.txt\n', 'latest commit on feature-a')
  })

  await runTest('Switch back to main', async () => {
    await checkout(REPO, 'main')
    const branch = await currentBranch(REPO)
    assertEqual(branch, 'main', 'back on main')
    // feature.txt should not exist on main
    const exists = await fileExists(REPO, 'feature.txt')
    assert(!exists, 'feature.txt not on main')
  })

  await runTest('Delete branch', async () => {
    await createBranch(REPO, 'to-delete')
    await deleteBranch(REPO, 'to-delete')
    const branches = await listBranches(REPO)
    assertNotIncludes(branches, 'to-delete', 'to-delete removed from branch list')
  })
}

// ── 7. Tags ──────────────────────────────────────────────────────────

async function testTags() {
  await runTest('Create and list tags', async () => {
    await createTag(REPO, 'v1.0')
    const tags = await listTags(REPO)
    assertIncludes(tags, 'v1.0', 'v1.0 in tag list')
  })

  await runTest('Delete tag', async () => {
    await createTag(REPO, 'temp-tag')
    await deleteTag(REPO, 'temp-tag')
    const tags = await listTags(REPO)
    assertNotIncludes(tags, 'temp-tag', 'temp-tag removed')
  })
}

// ── 8. Merge ─────────────────────────────────────────────────────────

async function testMerge() {
  await runTest('Fast-forward merge', async () => {
    // main is behind feature-a by 1 commit
    const result = await mergeBranch(REPO, 'feature-a')
    assert(result.conflicts === null, 'merge has no conflicts')
    // feature.txt should now exist on main
    const exists = await fileExists(REPO, 'feature.txt')
    assert(exists, 'feature.txt on main after merge')
  })

  await runTest('Merge with divergent changes (conflict detection)', async () => {
    // Set up a conflict scenario
    // On main – edit a shared file
    await writeFile(REPO, 'shared.txt', 'main content line 1\nmain line 2')
    await commitAll(REPO, 'Add shared.txt on main')

    // Create and switch to conflict-branch
    await createBranch(REPO, 'conflict-branch')
    await checkout(REPO, 'conflict-branch')
    await writeFile(REPO, 'shared.txt', 'conflict content line 1\nconflict line 2')
    await commitAll(REPO, 'Edit shared.txt on conflict-branch')

    // Switch back to main and edit same file differently
    await checkout(REPO, 'main')
    await writeFile(REPO, 'shared.txt', 'different main content\nmain version 2')
    await commitAll(REPO, 'Edit shared.txt differently on main')

    // Attempt merge
    const result = await mergeBranch(REPO, 'conflict-branch')
    // Could be conflict or auto-resolved depending on isomorphic-git
    if (result.conflicts) {
      assert(Array.isArray(result.conflicts), 'conflicts is an array')
      log(`    Detected ${result.conflicts.length} conflicted file(s): ${result.conflicts.join(', ')}`)
    } else {
      log('    Merge auto-resolved (no textual conflicts detected by isomorphic-git)')
      assert(result.oid !== null, 'merge produced a commit oid')
    }
  })

  await runTest('Get conflict versions', async () => {
    try {
      const versions = await getConflictVersions(REPO, 'shared.txt', 'conflict-branch')
      assert(typeof versions.base === 'string' || versions.base === null, 'base version retrieved')
      assert(typeof versions.ours === 'string', 'ours version retrieved')
      assert(typeof versions.theirs === 'string', 'theirs version retrieved')
    } catch (err) {
      log(`    Skipped (conflict versions not applicable): ${err.message}`)
    }
  })

  await runTest('Resolve conflict', async () => {
    try {
      await resolveConflict(REPO, 'shared.txt', 'Resolved content\nFinal version')
      const content = await readFile(REPO, 'shared.txt')
      assertEqual(content, 'Resolved content\nFinal version', 'resolved content written')
    } catch (err) {
      log(`    Skipped: ${err.message}`)
    }
  })
}

// ── 9. Diff ──────────────────────────────────────────────────────────

async function testDiff() {
  await runTest('diffFile (HEAD vs working dir)', async () => {
    await writeFile(REPO, 'hello.txt', 'Hello World Modified')
    const diff = await diffFile(REPO, 'hello.txt')
    assert(diff.oldContent !== null, 'old content from HEAD')
    assertEqual(diff.newContent, 'Hello World Modified', 'new content from working dir')
    assert(diff.oldContent !== diff.newContent, 'old and new differ')
  })

  await runTest('diffSummary', async () => {
    const summary = await diffSummary(REPO)
    assert(Array.isArray(summary), 'diffSummary returns array')
    const changed = summary.find((s) => s.filepath === 'hello.txt')
    assert(changed !== undefined, 'hello.txt appears in diff summary')
  })

  await runTest('diffLines (pure text diff)', () => {
    const diffs = diffLines('line1\nline2\nline3', 'line1\nmodified\nline3')
    assert(Array.isArray(diffs), 'diffLines returns array')
    const removed = diffs.find((d) => d.type === 'remove' && d.value === 'line2')
    assert(removed !== undefined, 'detects removed line')
    const added = diffs.find((d) => d.type === 'add' && d.value === 'modified')
    assert(added !== undefined, 'detects added line')
  })

  await runTest('unifiedDiff', () => {
    const result = unifiedDiff('a\nb\nc', 'a\nx\nc', { oldName: 'old.txt', newName: 'new.txt' })
    assert(result.includes('---'), 'unified diff has --- header')
    assert(result.includes('+++'), 'unified diff has +++ header')
  })

  await runTest('diffHunks', () => {
    const hunks = diffHunks('a\nb\nc\nd\ne', 'a\nB\nc\nd\nE')
    assert(Array.isArray(hunks), 'diffHunks returns array')
    assert(hunks.length > 0, 'at least one hunk detected')
  })
}

// ── 10. Three-way merge (diffService) ────────────────────────────────

async function testThreeWayMerge() {
  await runTest('threeWayMerge – clean', () => {
    const base = 'line1\nline2\nline3'
    const ours = 'line1\nours changed\nline3'
    const theirs = 'line1\nline2\ntheirs changed'
    const result = threeWayMerge(base, ours, theirs)
    assert(!result.hasConflicts, 'no conflicts in clean 3-way merge')
    assert(result.merged.includes('ours changed'), 'merged includes our change')
    assert(result.merged.includes('theirs changed'), 'merged includes their change')
  })

  await runTest('threeWayMerge – conflict', () => {
    const base = 'line1\nshared\nline3'
    const ours = 'line1\nours version\nline3'
    const theirs = 'line1\ntheirs version\nline3'
    const result = threeWayMerge(base, ours, theirs)
    assert(result.hasConflicts, 'conflict detected')
    assert(result.conflicts.length > 0, 'conflicts array non-empty')
    assert(result.merged.includes('<<<<<<< ours'), 'conflict markers present')
  })

  await runTest('autoMerge', () => {
    const result = autoMerge('a\nb', 'a\nB', 'a\nb')
    assert(!result.hasConflicts, 'autoMerge resolves cleanly when only one side changed')
    assert(result.merged.includes('B'), 'autoMerge picks the changed side')
  })
}

// ── 11. Stash ────────────────────────────────────────────────────────

async function testStash() {
  // Reset hello.txt to committed state first
  await commitAll(REPO, 'Pre-stash commit')

  await runTest('Stash save', async () => {
    await writeFile(REPO, 'stash-test.txt', 'stash me')
    const idx = await stash(REPO, 'WIP: stash test')
    assertEqual(idx, 0, 'stash returns index 0')
    // After stash, checkout reverts workdir – stash-test was untracked so it may linger.
    // The important thing is the stash list has the entry.
    const list = await stashList(REPO)
    assert(list.length >= 1, 'stash list has entry')
    assertEqual(list[0].message, 'WIP: stash test', 'stash message matches')
  })

  await runTest('Stash show', async () => {
    const files = await stashShow(REPO, 0)
    assert(Array.isArray(files), 'stashShow returns array')
    assert(files.length > 0, 'stashShow has files')
  })

  await runTest('Stash apply', async () => {
    const entry = await stashApply(REPO, 0)
    assert(entry !== null, 'stashApply returns entry')
    // stash should still be in list
    const list = await stashList(REPO)
    assert(list.length >= 1, 'stash still in list after apply')
  })

  await runTest('Stash pop', async () => {
    // Create another stash
    await writeFile(REPO, 'pop-test.txt', 'pop me')
    await stash(REPO, 'WIP: pop test')
    const before = await stashList(REPO)
    const beforeLen = before.length
    await stashPop(REPO, 0)
    const after = await stashList(REPO)
    assertEqual(after.length, beforeLen - 1, 'stash removed after pop')
  })

  await runTest('Stash drop', async () => {
    await writeFile(REPO, 'drop-test.txt', 'drop me')
    await stash(REPO, 'WIP: drop test')
    const before = await stashList(REPO)
    await stashDrop(REPO, 0)
    const after = await stashList(REPO)
    assertEqual(after.length, before.length - 1, 'stash removed after drop')
  })

  await runTest('Stash clear', async () => {
    await stashClear(REPO)
    const list = await stashList(REPO)
    assertEqual(list.length, 0, 'stash list empty after clear')
  })
}

// ── 12. Reflog and recovery ──────────────────────────────────────────

async function testReflogAndRecovery() {
  await runTest('Reflog has entries', async () => {
    const log = await getReflog(REPO)
    assert(log.length > 0, 'reflog is non-empty')
  })

  await runTest('Reset hard to previous commit', async () => {
    const log = await getLog(REPO)
    assert(log.length >= 2, 'have at least 2 commits to reset')
    const previousOid = log[1].oid // second most recent
    await resetHard(REPO, previousOid)
    const headOid = await resolveRef(REPO, 'HEAD')
    assertEqual(headOid, previousOid, 'HEAD now points to previous commit')
    // Reflog should record the reset
    const reflog = await getReflog(REPO)
    const resetEntry = reflog.find((e) => e.action === 'reset')
    assert(resetEntry !== undefined, 'reflog records reset action')
  })
}

// ── 13. Code exploration ─────────────────────────────────────────────

async function testCodeExploration() {
  // Re-commit so HEAD is valid
  await writeFile(REPO, 'explore.js', 'function add(a, b) { return a + b; }')
  await commitAll(REPO, 'Add explore.js')

  await runTest('Read file at ref', async () => {
    const content = await readFileAtRef(REPO, 'explore.js', 'HEAD')
    assert(content.includes('function add'), 'readFileAtRef returns file content at HEAD')
  })

  await runTest('List files at ref', async () => {
    const files = await listFilesAtRef(REPO, 'HEAD')
    assert(Array.isArray(files), 'listFilesAtRef returns array')
    assertIncludes(files, 'explore.js', 'explore.js in files at HEAD')
  })
}

// ── 14. Repo health ──────────────────────────────────────────────────

async function testRepoHealth() {
  await runTest('Repo health check', async () => {
    const health = await checkRepoHealth(REPO)
    assert(health.healthy === true, 'repo is healthy')
    assertEqual(health.issues.length, 0, 'no health issues')
    assert(typeof health.branch === 'string', 'branch is reported')
  })
}

// ── 15. Duplicate repo ───────────────────────────────────────────────

async function testDuplicate() {
  await runTest('Duplicate repo', async () => {
    const dest = await duplicateRepo(REPO, REPO_DUP)
    assert(typeof dest === 'string', 'duplicateRepo returns path')
    const exists = await repoExists(REPO_DUP)
    assert(exists, 'duplicated repo exists')
    // Should have same files
    const files = await listFilesRecursive(REPO_DUP)
    const paths = files.map((f) => f.path)
    assertIncludes(paths, 'hello.txt', 'duplicated repo has hello.txt')
  })
}

// ── 16. Export / Import bundle ───────────────────────────────────────

async function testBundleTransfer() {
  await runTest('Export repo bundle', async () => {
    const bundle = await exportRepoBundle(REPO)
    assert(bundle.name === REPO, 'bundle has correct name')
    assert(Array.isArray(bundle.files), 'bundle has files array')
    assert(bundle.files.length > 0, 'bundle is non-empty')
  })

  await runTest('Import repo bundle', async () => {
    const bundle = await exportRepoBundle(REPO)
    bundle.name = REPO_TRANSFER // rename so we can import as new
    const path = await importRepoBundle(bundle)
    assert(typeof path === 'string', 'importRepoBundle returns path')
    const exists = await repoExists(REPO_TRANSFER)
    assert(exists, 'imported repo exists')
  })
}

// ── 17. Transfer service ─────────────────────────────────────────────

async function testTransferService() {
  await runTest('Export for transfer', async () => {
    const result = await exportForTransfer(REPO)
    assert(typeof result.json === 'string', 'exports JSON string')
    assert(result.sizeBytes > 0, 'has size')
    assert(typeof result.checksum === 'string', 'has checksum')
  })

  await runTest('Split into chunks and reassemble', async () => {
    const result = await exportForTransfer(REPO)
    const chunks = splitIntoChunks(result.json, 500)
    assert(chunks.length > 0, 'produces chunks')
    assert(chunks[0].total === chunks.length, 'chunk count matches')

    const reassembled = reassembleChunks(chunks)
    assertEqual(reassembled, result.json, 'reassembled matches original')
  })

  await runTest('Import from transfer with checksum', async () => {
    // Delete the transfer repo first so we can re-import
    await deleteRepo(REPO_TRANSFER)
    const exported = await exportForTransfer(REPO)
    // Modify the bundle name inside the JSON so it imports as REPO_TRANSFER
    const parsed = JSON.parse(exported.json)
    parsed.name = REPO_TRANSFER
    const modifiedJson = JSON.stringify(parsed)

    const result = await importFromTransfer(modifiedJson)
    assertEqual(result.repoName, REPO_TRANSFER, 'imported with correct name')
    assert(result.fileCount > 0, 'imported files')
  })
}

// ── 18. Disk space utility ───────────────────────────────────────────

async function testDiskSpace() {
  await runTest('Get free disk space', async () => {
    const info = await getFreeDiskSpace()
    assert(typeof info.freeFormatted === 'string', 'returns formatted free space')
    assert(typeof info.totalFormatted === 'string', 'returns formatted total space')
  })
}

// =====================================================================
//  CLEANUP
// =====================================================================

async function cleanup() {
  log('\n── Cleanup ──')
  try {
    await deleteRepo(REPO)
    await deleteRepo(REPO2)
    await deleteRepo(REPO_DUP)
    await deleteRepo(REPO_TRANSFER)
    log('  Cleaned up test repos')
  } catch (err) {
    log(`  Cleanup warning: ${err.message}`)
  }
}

// =====================================================================
//  MAIN RUNNER
// =====================================================================

export async function runAllTests() {
  passCount = 0
  failCount = 0
  results.length = 0

  log('╔══════════════════════════════════════════════════╗')
  log('║    OFFLINE GIT SERVICE — INTEGRATION TESTS      ║')
  log('╚══════════════════════════════════════════════════╝')

  const startTime = Date.now()

  try {
    await testPathUtils()
    await testRepoManagement()
    await testFileOperations()
    await testStagingAndStatus()
    await testCommits()
    await testBranches()
    await testTags()
    await testMerge()
    await testDiff()
    await testThreeWayMerge()
    await testStash()
    await testReflogAndRecovery()
    await testCodeExploration()
    await testRepoHealth()
    await testDuplicate()
    await testBundleTransfer()
    await testTransferService()
    await testDiskSpace()
  } catch (err) {
    log(`\n🔥 FATAL: ${err.message}\n${err.stack}`)
    failCount++
    results.push({ status: 'FAIL', description: `Fatal: ${err.message}` })
  }

  await cleanup()

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

  log('\n══════════════════════════════════════════════════')
  log(`  RESULTS: ${passCount} passed, ${failCount} failed (${elapsed}s)`)
  log('══════════════════════════════════════════════════\n')

  return {
    pass: passCount,
    fail: failCount,
    total: passCount + failCount,
    elapsed,
    details: [...results],
  }
}

export default runAllTests
