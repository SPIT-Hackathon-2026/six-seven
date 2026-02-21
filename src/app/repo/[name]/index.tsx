import { useCallback, useState, useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'

import {
  currentBranch,
  getStatus,
  listBranches,
  commitAll,
  stageAll,
  createBranch,
  deleteBranch,
  checkout,
  getLog,
  listTags,
  createTag,
  deleteTag,
  mergeBranch,
  diffFile,
  listFilesAtRef,
  readFileAtRef,
  diffSummary,
  detectConflicts,
} from '@/services/gitService'
import { stash, stashPop } from '@/services/stashService'
import { deleteRepo, getRepoSize } from '@/services/repoService'

/* ───────────────── helpers ───────────────── */

type CommitEntry = {
  oid: string
  message: string
  author: string
  timestamp: number
}
type FileEntry = { filepath: string; status: string }
type TreeNode = {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes,
    i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${units[i]}`
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts * 1000
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Convert flat filepath list to tree structure */
function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const fp of files) {
    const parts = fp.split('/')
    let level = root
    let pathSoFar = ''
    for (let i = 0; i < parts.length; i++) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${parts[i]}` : parts[i]
      const isFile = i === parts.length - 1
      let existing = level.find((n) => n.name === parts[i])
      if (!existing) {
        existing = {
          name: parts[i],
          path: pathSoFar,
          type: isFile ? 'file' : 'dir',
          children: isFile ? undefined : [],
        }
        level.push(existing)
      }
      if (!isFile) level = existing.children!
    }
  }
  // Sort: dirs first, then alphabetical
  const sortLevel = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => n.children && sortLevel(n.children))
  }
  sortLevel(root)
  return root
}

/** Get extension for syntax hint */
function getExt(name: string) {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

function fileIcon(name: string) {
  const ext = getExt(name)
  const map: Record<string, string> = {
    js: '📜',
    jsx: '⚛',
    ts: '🔷',
    tsx: '⚛',
    json: '{ }',
    md: '📝',
    css: '🎨',
    html: '🌐',
    py: '🐍',
    java: '☕',
    kt: '🟣',
    xml: '📋',
    gradle: '🐘',
    yml: '⚙',
    yaml: '⚙',
    txt: '📄',
    gitignore: '👁',
  }
  return map[ext] ?? '📄'
}

/* ═══════════════ COMPONENT ═══════════════ */

export default function RepoDetailScreen() {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name: string }>()

  /* — core state — */
  const [branch, setBranch] = useState('main')
  const [branches, setBranches] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [modFiles, setModFiles] = useState<FileEntry[]>([])
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [repoSize, setRepoSize] = useState('...')
  const [loading, setLoading] = useState(true)

  /* — UI state — */
  const [activeTab, setActiveTab] = useState<
    'code' | 'branches' | 'tags' | 'overview'
  >('code')
  const [showBranchPicker, setShowBranchPicker] = useState(false)

  /* — Code tab — */
  const [treeFiles, setTreeFiles] = useState<string[]>([])
  const [treePath, setTreePath] = useState<string[]>([]) // breadcrumb path
  const [viewingFile, setViewingFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [loadingFile, setLoadingFile] = useState(false)

  /* — Branches tab — */
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [merging, setMerging] = useState(false)

  /* — Tags tab — */
  const [showTagInput, setShowTagInput] = useState(false)
  const [newTagName, setNewTagName] = useState('')

  /* — Overview tab — */
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)

  /* — Compare modal — */
  const [showCompare, setShowCompare] = useState(false)
  const [compareBranch, setCompareBranch] = useState<string | null>(null)
  const [compareResults, setCompareResults] = useState<
    { filepath: string; status: string }[] | null
  >(null)
  const [loadingCompare, setLoadingCompare] = useState(false)

  /* ─── tree from flat list ─── */
  const tree = useMemo(() => buildTree(treeFiles), [treeFiles])

  const currentLevel = useMemo(() => {
    let level = tree
    for (const seg of treePath) {
      const found = level.find((n) => n.name === seg && n.type === 'dir')
      if (found?.children) level = found.children
      else break
    }
    return level
  }, [tree, treePath])

  /* ─── data loading ─── */
  const loadRepoData = useCallback(async () => {
    if (!name) return
    setLoading(true)
    try {
      const [br, brs, status, log, tgs, size] = await Promise.all([
        currentBranch(name).catch(() => 'main'),
        listBranches(name).catch(() => []),
        getStatus(name).catch(() => []),
        getLog(name, { depth: 15 }).catch(() => []),
        listTags(name).catch(() => []),
        getRepoSize(name).catch(() => 0),
      ])
      setBranch(br ?? 'main')
      setBranches(brs)
      setTags(tgs)
      setRepoSize(formatBytes(size))
      setModFiles(
        status
          .filter((s: any) => s.status !== 'unmodified')
          .map((s: any) => ({ filepath: s.filepath, status: s.status })),
      )
      setCommits(
        log.map((e: any) => ({
          oid: e.oid,
          message: e.commit?.message ?? '',
          author: e.commit?.author?.name ?? 'Unknown',
          timestamp: e.commit?.author?.timestamp ?? 0,
        })),
      )

      // Load tree for code tab
      try {
        const files = await listFilesAtRef(name, br ?? 'main')
        setTreeFiles(files)
      } catch {
        setTreeFiles([])
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to load repo data')
    } finally {
      setLoading(false)
    }
  }, [name])

  useFocusEffect(
    useCallback(() => {
      loadRepoData()
    }, [loadRepoData]),
  )

  /* ─── handlers ─── */
  const handleCheckout = useCallback(
    async (b: string) => {
      if (!name) return
      try {
        await checkout(name, b)
        setShowBranchPicker(false)
        setTreePath([])
        setViewingFile(null)
        await loadRepoData()
      } catch (err: any) {
        Alert.alert('Checkout failed', err?.message ?? '')
      }
    },
    [name, loadRepoData],
  )

  const handleOpenFile = useCallback(
    async (filepath: string) => {
      if (!name) return
      setLoadingFile(true)
      setViewingFile(filepath)
      try {
        const content = await readFileAtRef(name, filepath, branch)
        setFileContent(content)
      } catch {
        setFileContent('(unable to read file)')
      } finally {
        setLoadingFile(false)
      }
    },
    [name, branch],
  )

  const handleCommit = useCallback(async () => {
    if (!name) return
    const msg = commitMsg.trim() || `Update ${new Date().toLocaleTimeString()}`
    setCommitting(true)
    try {
      await stageAll(name)
      await commitAll(name, msg)
      setCommitMsg('')
      Alert.alert('Success', 'Changes committed')
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Commit failed', err?.message ?? '')
    } finally {
      setCommitting(false)
    }
  }, [name, commitMsg, loadRepoData])

  const handleCreateBranch = useCallback(async () => {
    if (!name || !newBranchName.trim()) return
    try {
      await createBranch(name, newBranchName.trim(), { checkout: true })
      setNewBranchName('')
      setShowNewBranch(false)
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? '')
    }
  }, [name, newBranchName, loadRepoData])

  const handleDeleteBranch = useCallback(
    (b: string) => {
      if (b === branch) {
        Alert.alert('Error', 'Cannot delete the current branch')
        return
      }
      Alert.alert('Delete Branch', `Delete "${b}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBranch(name!, b)
              await loadRepoData()
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? '')
            }
          },
        },
      ])
    },
    [name, branch, loadRepoData],
  )

  const handleMerge = useCallback(
    (theirBranch: string) => {
      if (!name) return
      Alert.alert(
        'Merge Branch',
        `Merge "${theirBranch}" into "${branch}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Merge',
            onPress: async () => {
              setMerging(true)
              try {
                const result = await mergeBranch(name, theirBranch)
                if (result.conflicts && result.conflicts.length > 0) {
                  // Navigate to conflict resolution screen
                  router.push({
                    pathname: '/repo/[name]/conflicts' as any,
                    params: {
                      name,
                      theirBranch,
                      conflicts: JSON.stringify(result.conflicts),
                    },
                  })
                } else {
                  Alert.alert(
                    'Merged',
                    result?.oid
                      ? `New commit: ${result.oid.slice(0, 7)}`
                      : 'Already up to date',
                  )
                  await loadRepoData()
                }
              } catch (err: any) {
                // Try to detect conflicts even on error
                try {
                  const conflicts = await detectConflicts(name, theirBranch)
                  if (conflicts.length > 0) {
                    router.push({
                      pathname: '/repo/[name]/conflicts' as any,
                      params: {
                        name,
                        theirBranch,
                        conflicts: JSON.stringify(conflicts),
                      },
                    })
                    return
                  }
                } catch {}
                Alert.alert('Merge failed', err?.message ?? '')
              } finally {
                setMerging(false)
              }
            },
          },
        ],
      )
    },
    [name, branch, loadRepoData, router],
  )

  const handleCompare = useCallback(
    async (targetBranch: string) => {
      if (!name) return
      setCompareBranch(targetBranch)
      setShowCompare(true)
      setLoadingCompare(true)
      try {
        const summary = await diffSummary(name, branch, targetBranch)
        setCompareResults(summary)
      } catch {
        setCompareResults([])
      } finally {
        setLoadingCompare(false)
      }
    },
    [name, branch],
  )

  const handleCreateTag = useCallback(async () => {
    if (!name || !newTagName.trim()) return
    try {
      await createTag(name, newTagName.trim())
      setNewTagName('')
      setShowTagInput(false)
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? '')
    }
  }, [name, newTagName, loadRepoData])

  const handleDeleteTag = useCallback(
    (tag: string) => {
      Alert.alert('Delete Tag', `Delete "${tag}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTag(name!, tag)
              await loadRepoData()
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? '')
            }
          },
        },
      ])
    },
    [name, loadRepoData],
  )

  const handleStash = useCallback(async () => {
    if (!name) return
    try {
      await stash(name, `WIP on ${branch}`)
      Alert.alert('Stashed', 'Changes saved to stash')
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Stash failed', err?.message ?? '')
    }
  }, [name, branch, loadRepoData])

  const handleStashPop = useCallback(async () => {
    if (!name) return
    try {
      await stashPop(name)
      Alert.alert('Applied', 'Last stash applied')
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Stash pop failed', err?.message ?? '')
    }
  }, [name, loadRepoData])

  const handleDeleteRepo = useCallback(() => {
    Alert.alert(
      'Delete Repository',
      `Permanently delete "${name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteRepo(name!)
              router.back()
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? '')
            }
          },
        },
      ],
    )
  }, [name, router])

  const handleEditFile = useCallback(
    (filepath: string) => {
      if (!name) return
      router.push({
        pathname: '/repo/[name]/editor' as any,
        params: { name, path: filepath },
      })
    },
    [name, router],
  )

  /* ─── guard ─── */
  if (!name) {
    return (
      <View className="flex-1 bg-[#0d1117] items-center justify-center">
        <Text className="text-[#e6edf3]">Invalid repository</Text>
      </View>
    )
  }

  /* ═══════ TABS ═══════ */
  const TABS = ['code', 'branches', 'tags', 'overview'] as const
  const TAB_ICONS: Record<string, string> = {
    code: '📁',
    branches: '⎇',
    tags: '🏷',
    overview: '📊',
  }

  /* ═══════ RENDER ═══════ */
  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* ── Header ── */}
      <View className="flex-row items-center justify-between px-4 pt-14 pb-3 border-b border-[#30363d] bg-[#161b22]">
        <TouchableOpacity onPress={() => router.back()} className="p-1">
          <Text className="text-[#58a6ff] text-2xl font-bold">‹</Text>
        </TouchableOpacity>
        <View className="flex-1 items-center">
          <Text className="text-[#e6edf3] text-lg font-bold">{name}</Text>
          <Text className="text-[#8b949e] text-[11px]">{repoSize}</Text>
        </View>
        <TouchableOpacity onPress={handleDeleteRepo} className="p-1">
          <Text className="text-[#f85149]">🗑</Text>
        </TouchableOpacity>
      </View>

      {/* ── Branch selector row ── */}
      <View className="flex-row items-center px-4 py-2 bg-[#161b22] border-b border-[#30363d]">
        <TouchableOpacity
          className="flex-row items-center px-3 py-1.5 rounded-md bg-[#21262d] border border-[#30363d]"
          onPress={() => setShowBranchPicker(!showBranchPicker)}
        >
          <Text className="text-[#e6edf3] text-xs mr-1">⎇</Text>
          <Text className="text-[#e6edf3] text-sm font-semibold">
            {branch}
          </Text>
          <Text className="text-[#8b949e] text-xs ml-1.5">▼</Text>
        </TouchableOpacity>
        <View className="flex-row ml-3 gap-3">
          <Text className="text-[#8b949e] text-xs">
            {branches.length} branch{branches.length !== 1 ? 'es' : ''}
          </Text>
          <Text className="text-[#8b949e] text-xs">
            {tags.length} tag{tags.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {/* Branch picker dropdown */}
      {showBranchPicker && (
        <View className="mx-4 mt-1 rounded-lg bg-[#161b22] border border-[#30363d] z-10 absolute top-[120] left-0 right-0 max-h-[300]">
          <ScrollView>
            <View className="px-3 py-2 border-b border-[#30363d]">
              <Text className="text-[#8b949e] text-xs font-bold">
                Switch branches
              </Text>
            </View>
            {branches.map((b) => (
              <TouchableOpacity
                key={b}
                className="px-3 py-2.5 border-b border-[#21262d] flex-row items-center justify-between"
                onPress={() => handleCheckout(b)}
              >
                <View className="flex-row items-center gap-2">
                  {b === branch ? (
                    <Text className="text-[#58a6ff] text-xs">✓</Text>
                  ) : (
                    <Text className="text-transparent text-xs">✓</Text>
                  )}
                  <Text
                    className={
                      b === branch
                        ? 'text-[#58a6ff] font-semibold text-sm'
                        : 'text-[#c9d1d9] text-sm'
                    }
                  >
                    {b}
                  </Text>
                </View>
                {b === branch && (
                  <View className="px-1.5 py-0.5 rounded-full bg-[#1f6feb33]">
                    <Text className="text-[#58a6ff] text-[10px]">default</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Tab bar (GitHub-style) ── */}
      <View className="flex-row border-b border-[#30363d]">
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            className="flex-1 flex-row items-center justify-center gap-1 py-2.5"
            onPress={() => {
              setActiveTab(tab)
              setShowBranchPicker(false)
            }}
          >
            <Text className="text-xs">{TAB_ICONS[tab]}</Text>
            <Text
              className={
                activeTab === tab
                  ? 'text-[#e6edf3] text-[13px] font-semibold'
                  : 'text-[#8b949e] text-[13px]'
              }
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
            {activeTab === tab && (
              <View className="absolute bottom-0 left-2 right-2 h-[2px] bg-[#f78166] rounded-t" />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Content ── */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={loadRepoData}
            tintColor="#58a6ff"
          />
        }
      >
        {loading ? (
          <View className="mt-8 items-center">
            <ActivityIndicator color="#58a6ff" />
          </View>
        ) : activeTab === 'code' ? (
          /* ──────────── CODE TAB ──────────── */
          <View className="px-4 mt-3">
            {viewingFile ? (
              /* File viewer */
              <>
                <View className="flex-row items-center mb-2 gap-2">
                  <TouchableOpacity
                    onPress={() => {
                      setViewingFile(null)
                      setFileContent('')
                    }}
                    className="px-2 py-1 rounded bg-[#21262d]"
                  >
                    <Text className="text-[#58a6ff] text-xs">← Back</Text>
                  </TouchableOpacity>
                  <Text
                    className="text-[#e6edf3] text-sm flex-1"
                    numberOfLines={1}
                  >
                    {viewingFile}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleEditFile(viewingFile)}
                    className="px-2 py-1 rounded bg-[#21262d]"
                  >
                    <Text className="text-[#58a6ff] text-xs">✏ Edit</Text>
                  </TouchableOpacity>
                </View>

                {/* Breadcrumb */}
                <View className="flex-row flex-wrap mb-2">
                  {viewingFile.split('/').map((seg, i, arr) => (
                    <Text key={i} className="text-[#8b949e] text-xs">
                      {i > 0 && (
                        <Text className="text-[#484f58]"> / </Text>
                      )}
                      <Text
                        className={
                          i === arr.length - 1
                            ? 'text-[#e6edf3] font-semibold'
                            : 'text-[#58a6ff]'
                        }
                      >
                        {seg}
                      </Text>
                    </Text>
                  ))}
                </View>

                {loadingFile ? (
                  <ActivityIndicator color="#58a6ff" className="mt-4" />
                ) : (
                  <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                    {/* File header */}
                    <View className="flex-row items-center justify-between px-3 py-2 bg-[#161b22] border-b border-[#30363d]">
                      <Text className="text-[#8b949e] text-xs">
                        {fileContent.split('\n').length} lines
                      </Text>
                      <Text className="text-[#8b949e] text-xs">
                        {branch}
                      </Text>
                    </View>
                    {/* Code lines */}
                    <ScrollView horizontal>
                      <View className="p-3">
                        {fileContent.split('\n').map((line, idx) => (
                          <View key={idx} className="flex-row">
                            <Text className="text-[#484f58] text-[11px] w-8 text-right mr-3 font-mono">
                              {idx + 1}
                            </Text>
                            <Text className="text-[#e6edf3] text-[11px] font-mono">
                              {line || ' '}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}
              </>
            ) : (
              /* File tree */
              <>
                {/* Breadcrumb nav */}
                <View className="flex-row items-center mb-2 flex-wrap">
                  <TouchableOpacity onPress={() => setTreePath([])}>
                    <Text className="text-[#58a6ff] text-sm font-semibold">
                      {name}
                    </Text>
                  </TouchableOpacity>
                  {treePath.map((seg, i) => (
                    <View key={i} className="flex-row items-center">
                      <Text className="text-[#484f58] text-sm mx-1">/</Text>
                      <TouchableOpacity
                        onPress={() => setTreePath(treePath.slice(0, i + 1))}
                      >
                        <Text className="text-[#58a6ff] text-sm">{seg}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                {/* Last commit banner */}
                {commits.length > 0 && (
                  <View className="rounded-t-lg bg-[#161b22] border border-[#30363d] px-3 py-2 flex-row items-center">
                    <View className="w-5 h-5 rounded-full bg-[#30363d] mr-2 items-center justify-center">
                      <Text className="text-[#e6edf3] text-[9px]">
                        {commits[0].author.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text
                      className="text-[#e6edf3] text-xs flex-1"
                      numberOfLines={1}
                    >
                      {commits[0].message.trim()}
                    </Text>
                    <Text className="text-[#8b949e] text-[11px] ml-2">
                      {timeAgo(commits[0].timestamp)}
                    </Text>
                  </View>
                )}

                {/* File listing */}
                <View
                  className={`bg-[#0d1117] border-x border-b border-[#30363d] ${commits.length === 0 ? 'rounded-t-lg border-t' : ''} rounded-b-lg overflow-hidden`}
                >
                  {treePath.length > 0 && (
                    <TouchableOpacity
                      className="flex-row items-center px-3 py-2.5 border-b border-[#21262d]"
                      onPress={() =>
                        setTreePath(treePath.slice(0, treePath.length - 1))
                      }
                    >
                      <Text className="text-[#58a6ff] text-sm">..</Text>
                    </TouchableOpacity>
                  )}
                  {currentLevel.length === 0 ? (
                    <View className="px-3 py-6 items-center">
                      <Text className="text-[#484f58] text-sm">
                        No files at this ref
                      </Text>
                    </View>
                  ) : (
                    currentLevel.map((node) => (
                      <TouchableOpacity
                        key={node.path}
                        className="flex-row items-center px-3 py-2.5 border-b border-[#21262d]"
                        onPress={() => {
                          if (node.type === 'dir') {
                            setTreePath([...treePath, node.name])
                          } else {
                            handleOpenFile(node.path)
                          }
                        }}
                      >
                        <Text className="text-sm mr-2.5">
                          {node.type === 'dir' ? '📂' : fileIcon(node.name)}
                        </Text>
                        <Text
                          className={
                            node.type === 'dir'
                              ? 'text-[#58a6ff] text-sm flex-1'
                              : 'text-[#e6edf3] text-sm flex-1'
                          }
                          numberOfLines={1}
                        >
                          {node.name}
                        </Text>
                        {node.type === 'dir' && (
                          <Text className="text-[#484f58] text-xs">›</Text>
                        )}
                      </TouchableOpacity>
                    ))
                  )}
                </View>

                {/* Quick stats */}
                <View className="flex-row gap-3 mt-3">
                  <View className="flex-row items-center gap-1">
                    <Text className="text-[#8b949e] text-xs">◷</Text>
                    <Text className="text-[#8b949e] text-xs">
                      {commits.length} commit{commits.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  {modFiles.length > 0 && (
                    <View className="flex-row items-center gap-1">
                      <View className="w-2 h-2 rounded-full bg-[#d29922]" />
                      <Text className="text-[#d29922] text-xs">
                        {modFiles.length} uncommitted
                      </Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </View>
        ) : activeTab === 'branches' ? (
          /* ──────────── BRANCHES TAB ──────────── */
          <View className="px-4 mt-3">
            {/* New branch button */}
            <TouchableOpacity
              className="py-2.5 rounded-lg bg-[#238636] items-center mb-3"
              onPress={() => setShowNewBranch(!showNewBranch)}
            >
              <Text className="text-white text-sm font-semibold">
                + New Branch
              </Text>
            </TouchableOpacity>

            {showNewBranch && (
              <View className="mb-3 rounded-lg bg-[#161b22] border border-[#30363d] p-3">
                <Text className="text-[#8b949e] text-xs mb-2">
                  Create from "{branch}"
                </Text>
                <View className="flex-row gap-2">
                  <TextInput
                    className="flex-1 bg-[#0d1117] text-[#e6edf3] px-3 py-1.5 rounded-md border border-[#30363d] text-sm"
                    value={newBranchName}
                    onChangeText={setNewBranchName}
                    placeholder="feature/my-branch"
                    placeholderTextColor="#484f58"
                    autoFocus
                  />
                  <TouchableOpacity
                    className="px-3 py-1.5 rounded-md bg-[#238636]"
                    onPress={handleCreateBranch}
                  >
                    <Text className="text-white text-sm">Create</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Default branch */}
            <View className="mb-2">
              <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-1">
                Default
              </Text>
            </View>

            {/* Branch list */}
            <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
              {branches.map((b, idx) => (
                <View
                  key={b}
                  className={`px-3 py-3 ${idx < branches.length - 1 ? 'border-b border-[#21262d]' : ''}`}
                >
                  <View className="flex-row items-center justify-between">
                    <TouchableOpacity
                      className="flex-1 flex-row items-center gap-2"
                      onPress={() => handleCheckout(b)}
                    >
                      <Text className="text-sm">⎇</Text>
                      <Text
                        className={
                          b === branch
                            ? 'text-[#58a6ff] font-semibold text-sm'
                            : 'text-[#c9d1d9] text-sm'
                        }
                      >
                        {b}
                      </Text>
                      {b === branch && (
                        <View className="px-1.5 py-0.5 rounded-full bg-[#1f6feb33]">
                          <Text className="text-[#58a6ff] text-[10px]">
                            current
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Branch action buttons */}
                  <View className="flex-row gap-2 mt-2">
                    {b !== branch && (
                      <>
                        <TouchableOpacity
                          className="px-2.5 py-1 rounded bg-[#21262d] border border-[#30363d]"
                          onPress={() => handleCheckout(b)}
                        >
                          <Text className="text-[#c9d1d9] text-xs">
                            Checkout
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="px-2.5 py-1 rounded bg-[#21262d] border border-[#30363d]"
                          onPress={() => handleMerge(b)}
                          disabled={merging}
                        >
                          <Text className="text-[#c9d1d9] text-xs">
                            {merging ? 'Merging...' : 'Merge'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="px-2.5 py-1 rounded bg-[#21262d] border border-[#30363d]"
                          onPress={() => handleCompare(b)}
                        >
                          <Text className="text-[#58a6ff] text-xs">
                            Compare
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="px-2.5 py-1 rounded bg-[#21262d] border border-[#30363d]"
                          onPress={() => handleDeleteBranch(b)}
                        >
                          <Text className="text-[#f85149] text-xs">
                            Delete
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {b === branch && (
                      <Text className="text-[#484f58] text-xs italic">
                        Active branch
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>

            {/* Compare modal */}
            {showCompare && compareBranch && (
              <View className="mt-4 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                <View className="flex-row items-center justify-between px-3 py-2 bg-[#21262d] border-b border-[#30363d]">
                  <Text className="text-[#e6edf3] text-sm font-semibold">
                    Comparing: {branch} ← {compareBranch}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowCompare(false)
                      setCompareResults(null)
                    }}
                  >
                    <Text className="text-[#8b949e] text-sm">✕</Text>
                  </TouchableOpacity>
                </View>
                {loadingCompare ? (
                  <View className="py-4 items-center">
                    <ActivityIndicator color="#58a6ff" />
                  </View>
                ) : compareResults && compareResults.length === 0 ? (
                  <View className="px-3 py-4 items-center">
                    <Text className="text-[#7ee787] text-sm">
                      ✓ Branches are identical
                    </Text>
                  </View>
                ) : (
                  <View>
                    <View className="px-3 py-2 border-b border-[#21262d]">
                      <Text className="text-[#8b949e] text-xs">
                        {compareResults?.length ?? 0} file
                        {(compareResults?.length ?? 0) !== 1 ? 's' : ''} changed
                      </Text>
                    </View>
                    {compareResults?.map((f) => (
                      <View
                        key={f.filepath}
                        className="flex-row items-center px-3 py-2 border-b border-[#21262d]"
                      >
                        <Text
                          className="text-xs font-bold w-5"
                          style={{
                            color: f.status.includes('added')
                              ? '#7ee787'
                              : f.status.includes('deleted')
                                ? '#f85149'
                                : '#d29922',
                          }}
                        >
                          {f.status.includes('added')
                            ? '+'
                            : f.status.includes('deleted')
                              ? '−'
                              : '~'}
                        </Text>
                        <Text
                          className="text-[#e6edf3] text-xs flex-1"
                          numberOfLines={1}
                        >
                          {f.filepath}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Full compare page link */}
            <TouchableOpacity
              className="mt-3 py-2.5 rounded-lg bg-[#21262d] border border-[#30363d] items-center"
              onPress={() =>
                router.push({
                  pathname: '/repo/[name]/compare' as any,
                  params: { name },
                })
              }
            >
              <Text className="text-[#58a6ff] text-sm font-semibold">
                Open Full Compare View →
              </Text>
            </TouchableOpacity>
          </View>
        ) : activeTab === 'tags' ? (
          /* ──────────── TAGS TAB ──────────── */
          <View className="px-4 mt-3">
            <TouchableOpacity
              className="py-2.5 rounded-lg bg-[#238636] items-center mb-3"
              onPress={() => setShowTagInput(!showTagInput)}
            >
              <Text className="text-white text-sm font-semibold">
                + New Tag
              </Text>
            </TouchableOpacity>

            {showTagInput && (
              <View className="mb-3 rounded-lg bg-[#161b22] border border-[#30363d] p-3">
                <Text className="text-[#8b949e] text-xs mb-2">
                  Tag at HEAD ({branch})
                </Text>
                <View className="flex-row gap-2">
                  <TextInput
                    className="flex-1 bg-[#0d1117] text-[#e6edf3] px-3 py-1.5 rounded-md border border-[#30363d] text-sm"
                    value={newTagName}
                    onChangeText={setNewTagName}
                    placeholder="v1.0.0"
                    placeholderTextColor="#484f58"
                    autoFocus
                  />
                  <TouchableOpacity
                    className="px-3 py-1.5 rounded-md bg-[#238636]"
                    onPress={handleCreateTag}
                  >
                    <Text className="text-white text-sm">Create</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
              {tags.length === 0 ? (
                <View className="px-3 py-6 items-center">
                  <Text className="text-[#484f58] text-sm">No tags yet</Text>
                  <Text className="text-[#484f58] text-xs mt-1">
                    Tags mark specific points in history
                  </Text>
                </View>
              ) : (
                tags.map((t, idx) => (
                  <View
                    key={t}
                    className={`flex-row items-center justify-between px-3 py-3 ${idx < tags.length - 1 ? 'border-b border-[#21262d]' : ''}`}
                  >
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm">🏷</Text>
                      <Text className="text-[#e6edf3] text-sm">{t}</Text>
                    </View>
                    <TouchableOpacity
                      className="px-2 py-1 rounded bg-[#21262d] border border-[#30363d]"
                      onPress={() => handleDeleteTag(t)}
                    >
                      <Text className="text-[#f85149] text-xs">Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          </View>
        ) : (
          /* ──────────── OVERVIEW TAB ──────────── */
          <View className="px-4 mt-3">
            {/* Quick actions */}
            <View className="flex-row gap-2">
              <TouchableOpacity
                className="flex-1 py-2.5 rounded-lg bg-[#238636] items-center"
                onPress={handleCommit}
                disabled={committing}
              >
                {committing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text className="text-white text-sm font-semibold">
                    Commit All
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                className="py-2.5 px-4 rounded-lg bg-[#21262d] border border-[#30363d] items-center"
                onPress={handleStash}
              >
                <Text className="text-[#c9d1d9] text-sm">Stash</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="py-2.5 px-4 rounded-lg bg-[#21262d] border border-[#30363d] items-center"
                onPress={handleStashPop}
              >
                <Text className="text-[#c9d1d9] text-sm">Pop</Text>
              </TouchableOpacity>
            </View>

            {/* Commit message */}
            <TextInput
              className="mt-3 bg-[#0d1117] text-[#e6edf3] px-3 py-2 rounded-lg border border-[#30363d] text-sm"
              placeholder="Commit message (auto-generated if empty)"
              placeholderTextColor="#484f58"
              value={commitMsg}
              onChangeText={setCommitMsg}
            />

            {/* Status summary */}
            <View className="mt-4 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
              <View className="px-3 py-2 bg-[#21262d] border-b border-[#30363d]">
                <Text className="text-[#e6edf3] text-sm font-semibold">
                  {modFiles.length === 0
                    ? '✓ Working tree clean'
                    : `${modFiles.length} changed file${modFiles.length !== 1 ? 's' : ''}`}
                </Text>
              </View>
              {modFiles.length > 0 && (
                <View>
                  {modFiles.slice(0, 10).map((f) => (
                    <TouchableOpacity
                      key={f.filepath}
                      className="flex-row items-center px-3 py-2 border-b border-[#21262d]"
                      onPress={() => handleEditFile(f.filepath)}
                    >
                      <Text
                        className="text-xs font-bold w-5"
                        style={{
                          color: f.status.includes('added')
                            ? '#7ee787'
                            : f.status.includes('deleted')
                              ? '#f85149'
                              : '#d29922',
                        }}
                      >
                        {f.status.includes('added')
                          ? 'A'
                          : f.status.includes('deleted')
                            ? 'D'
                            : 'M'}
                      </Text>
                      <Text
                        className="text-[#c9d1d9] text-xs flex-1"
                        numberOfLines={1}
                      >
                        {f.filepath}
                      </Text>
                      <Text className="text-[#484f58] text-xs">›</Text>
                    </TouchableOpacity>
                  ))}
                  {modFiles.length > 10 && (
                    <View className="px-3 py-2">
                      <Text className="text-[#484f58] text-xs">
                        +{modFiles.length - 10} more files
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Recent Commits */}
            <View className="mt-4">
              <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-2">
                Recent Commits
              </Text>
              <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                {commits.length === 0 ? (
                  <View className="px-3 py-6 items-center">
                    <Text className="text-[#484f58] text-sm">
                      No commits yet
                    </Text>
                  </View>
                ) : (
                  commits.slice(0, 8).map((c, idx) => (
                    <View
                      key={c.oid}
                      className={`flex-row items-start px-3 py-2.5 ${idx < Math.min(commits.length, 8) - 1 ? 'border-b border-[#21262d]' : ''}`}
                    >
                      <View className="w-6 h-6 rounded-full bg-[#21262d] mr-2.5 items-center justify-center mt-0.5">
                        <Text className="text-[#8b949e] text-[10px]">
                          {c.author.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-[#e6edf3] text-sm"
                          numberOfLines={1}
                        >
                          {c.message.trim()}
                        </Text>
                        <Text className="text-[#484f58] text-xs mt-0.5">
                          {c.author} committed {timeAgo(c.timestamp)}{' '}
                          <Text className="text-[#484f58] font-mono">
                            {c.oid.slice(0, 7)}
                          </Text>
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
