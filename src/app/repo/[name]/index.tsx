import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import {
  FileCode,
  FileJson,
  FileText,
  Image as ImageIcon,
  Code2,
  Globe,
  Braces,
  Terminal,
  File as FileIcon,
  FolderGit2,
  GitBranch,
  Tag,
  LayoutDashboard,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Trash2,
  Share2,
  Check,
  Plus,
  History,
  Circle,
  Clock,
  RefreshCw,
  ArrowUpFromLine,
  ArrowDownToLine,
  Link2,
  Github,
  BarChart3,
  ShieldCheck,
  Search,
  MessageCircle,
} from 'lucide-react-native';
import {
  currentBranch,
  listBranches,
  getStatus,
  getLog,
  listTags,
  checkout,
  stageAll,
  commitAll,
  createBranch,
  deleteBranch,
  mergeBranch,
  detectConflicts,
  diffSummary,
  rebase,
  createTag,
  deleteTag,
  listFilesAtRef,
  readFileAtRef,
  addRemote,
  listRemotes,
  getRemoteUrl,
  fetchRemote,
  pullRemote,
  pushRemote,
} from '@/services/gitService';
import { deleteRepo, getRepoSize } from '@/services/repoService';
import { stash, stashPop } from '@/services/stashService';
import { isOnline } from '@/services/networkService';
import { enqueuePush, syncRepo } from '@/services/offlineSyncService';
import { isGitHubLinked, createGitHubRepo, getCachedUsername, listCollaborators, addCollaborator } from '@/services/githubAuth';
import SyntaxHighlighter from '@/components/SyntaxHighlighter';

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

// import {
//   FileCode,
//   FileJson,
//   FileText,
//   Image as ImageIcon,
//   Code2,
//   Globe,
//   Braces,
//   Terminal,
//   File as FileIcon,
// } from 'lucide-react-native'

function getFileIcon(name: string) {
  const ext = getExt(name)
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return <Code2 size={16} color="#8b949e" />
    case 'json':
      return <Braces size={16} color="#8b949e" />
    case 'md':
    case 'txt':
      return <FileText size={16} color="#8b949e" />
    case 'html':
    case 'css':
      return <Globe size={16} color="#8b949e" />
    case 'sh':
    case 'bat':
      return <Terminal size={16} color="#8b949e" />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':      return <ImageIcon size={16} color="#8b949e" />
    case 'xml':
      return <FileCode size={16} color="#8b949e" />
    default:
      return <FileIcon size={16} color="#8b949e" />
  }
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
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<'push' | 'pull' | 'fetch' | null>(null)
  const [showAddRemote, setShowAddRemote] = useState(false)
  const [newRemoteUrl, setNewRemoteUrl] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [ghLinked, setGhLinked] = useState(false)

  /* — Compare modal — */
  const [showCompare, setShowCompare] = useState(false)
  const [compareBranch, setCompareBranch] = useState<string | null>(null)
  const [compareResults, setCompareResults] = useState<
    { filepath: string; status: string }[] | null
  >(null)
  const [loadingCompare, setLoadingCompare] = useState(false)

   // Collaborator state
   const [collabUsername, setCollabUsername] = useState('');
   const [collabStatus, setCollabStatus] = useState('');
   const [collabStatusColor, setCollabStatusColor] = useState('#2ea043');
   const [addingCollab, setAddingCollab] = useState(false);
   // Handler for adding collaborator
   const handleAddCollaborator = useCallback(async () => {
     if (!name || !collabUsername.trim()) {
       setCollabStatus('Enter a valid username');
       setCollabStatusColor('#f85149');
       return;
     }
     setAddingCollab(true);
     setCollabStatus('');
     setCollabStatusColor('#2ea043');
     try {
       // Get owner username from GitHub auth cache
       const { getCachedUsername, addCollaborator } = await import('@/services/githubAuth');
       const owner = getCachedUsername();
       if (!owner) throw new Error('GitHub account not linked');
       await addCollaborator(owner, name, collabUsername);
       setCollabStatus('Collaborator added!');
       setCollabStatusColor('#2ea043');
       setCollabUsername('');
     } catch (err) {
       setCollabStatus('Failed to add collaborator');
       setCollabStatusColor('#f85149');
     } finally {
       setAddingCollab(false);
     }
   }, [name, collabUsername]);
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

      // Check remote & GitHub link
      const rUrl = await getRemoteUrl(name).catch(() => null)
      setRemoteUrl(rUrl)
      const linked = await isGitHubLinked().catch(() => false)
      setGhLinked(linked)
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

      // Auto-enqueue push if remote exists
      if (remoteUrl && ghLinked) {
        try {
          const log = await getLog(name, { depth: 1 })
          const oid = log[0]?.oid ?? 'unknown'
          await enqueuePush(name, branch, oid, msg)
        } catch { /* silent */ }
      }

      setCommitMsg('')
      Alert.alert('Success', 'Changes committed')
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Commit failed', err?.message ?? '')
    } finally {
      setCommitting(false)
    }
  }, [name, commitMsg, branch, remoteUrl, ghLinked, loadRepoData])

  const handlePush = useCallback(async () => {
    if (!name) return
    if (!isOnline()) {
      // Queue for later
      const oid = commits[0]?.oid ?? 'unknown'
      await enqueuePush(name, branch, oid, commits[0]?.message ?? 'push')
      Alert.alert('Offline', 'Push queued — will auto-sync when you come back online.')
      return
    }
    setSyncing('push')
    try {
      await pushRemote(name)
      Alert.alert('Pushed', `Pushed to origin/${branch}`)
    } catch (err: any) {
      if (err?.message?.includes('not a simple fast-forward') || err?.message?.includes('non-fast-forward')) {
        Alert.alert(
          'Push Rejected',
          'Remote has new commits. Pull first to merge changes, then push again.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Pull & Push',
              onPress: async () => {
                setSyncing('pull')
                try {
                  await pullRemote(name)
                  await pushRemote(name)
                  Alert.alert('Synced', 'Pulled and pushed successfully')
                  await loadRepoData()
                } catch (pullErr: any) {
                  Alert.alert('Sync failed', pullErr?.message ?? '')
                } finally {
                  setSyncing(null)
                }
              },
            },
          ],
        )
      } else {
        Alert.alert('Push failed', err?.message ?? '')
      }
    } finally {
      setSyncing(null)
    }
  }, [name, branch, commits, loadRepoData])

  const handlePull = useCallback(async () => {
    if (!name) return
    if (!isOnline()) {
      Alert.alert('Offline', 'Cannot pull while offline. Will sync when back online.')
      return
    }
    setSyncing('pull')
    try {
      await pullRemote(name)
      Alert.alert('Pulled', `Pulled from origin/${branch}`)
      await loadRepoData()
    } catch (err: any) {
      if (err?.message?.includes('conflict') || err?.message?.includes('merge')) {
        Alert.alert('Merge Conflict', 'Pull resulted in conflicts. Resolve them in Source Control.', [
          { text: 'OK' },
        ])
      } else {
        Alert.alert('Pull failed', err?.message ?? '')
      }
    } finally {
      setSyncing(null)
    }
  }, [name, branch, loadRepoData])

  const handleSync = useCallback(async () => {
    if (!name) return
    if (!isOnline()) {
      Alert.alert('Offline', 'Will auto-sync when you come back online.')
      return
    }
    setSyncing('fetch')
    try {
      const result = await syncRepo(name)
      if (result.status === 'conflict') {
        Alert.alert('Conflict', result.detail ?? 'Merge conflict detected. Resolve in Source Control.')
      } else {
        Alert.alert('Synced', `Status: ${result.status}`)
      }
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Sync failed', err?.message ?? '')
    } finally {
      setSyncing(null)
    }
  }, [name, loadRepoData])

  const handleFetch = useCallback(async () => {
    if (!name) return
    setSyncing('fetch')
    try {
      await fetchRemote(name)
      Alert.alert('Fetched', 'Remote refs updated')
    } catch (err: any) {
      Alert.alert('Fetch failed', err?.message ?? '')
    } finally {
      setSyncing(null)
    }
  }, [name])

  const handleAddRemote = useCallback(async () => {
    if (!name || !newRemoteUrl.trim()) return
    try {
      // Remove existing origin if any, then add the new one
      const remotes = await listRemotes(name).catch(() => [])
      if (remotes.some((r: any) => r.remote === 'origin')) {
        const { deleteRemote: delRemote } = await import('@/services/gitService')
        await delRemote(name, 'origin')
      }
      await addRemote(name, 'origin', newRemoteUrl.trim())
      setRemoteUrl(newRemoteUrl.trim())
      setNewRemoteUrl('')
      setShowAddRemote(false)
      Alert.alert('Remote added', `origin → ${newRemoteUrl.trim()}`)
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to add remote')
    }
  }, [name, newRemoteUrl])

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
      Alert.alert('Merge Branch', `Merge "${theirBranch}" into "${branch}"?`, [
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
      ])
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
        const summary = await diffSummary(
          name,
          branch ?? 'main',
          targetBranch as any,
        )
        setCompareResults(summary)
      } catch {
        setCompareResults([])
      } finally {
        setLoadingCompare(false)
      }
    },
    [name, branch],
  )

  const handleRebase = useCallback(
    (ontoBranch: string) => {
      if (!name) return
      Alert.alert(
        'Rebase',
        `Rebase "${branch}" onto "${ontoBranch}"? This replays your commits on top of "${ontoBranch}".`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Rebase',
            onPress: async () => {
              try {
                const result = await rebase(name, ontoBranch)
                Alert.alert(
                  'Rebase complete',
                  `${result.replayedCommits} commit${result.replayedCommits !== 1 ? 's' : ''} replayed`,
                )
                await loadRepoData()
              } catch (err: any) {
                Alert.alert('Rebase failed', err?.message ?? '')
              }
            },
          },
        ],
      )
    },
    [name, branch, loadRepoData],
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
        params: { name, file: filepath },
      })
    },
    [name, router],
  )

  /* ─── guard ─── */
  if (!name) {
    return (
      <View className="flex-1 bg-neutral-100 dark:bg-black items-center justify-center">
        <Text className="text-black dark:text-neutral-100">
          Invalid repository
        </Text>
      </View>
    )
  }

  /* ═══════ TABS ═══════ */
  const TABS = ['code', 'branches', 'tags', 'overview'] as const
  const TabIconCode = ({ active }: { active: boolean }) => (
    <FolderGit2 size={16} color={active ? '#58a6ff' : '#8b949e'} />
  )
  const TabIconBranches = ({ active }: { active: boolean }) => (
    <GitBranch size={16} color={active ? '#58a6ff' : '#8b949e'} />
  )
  const TabIconTags = ({ active }: { active: boolean }) => (
    <Tag size={16} color={active ? '#58a6ff' : '#8b949e'} />
  )
  const TabIconOverview = ({ active }: { active: boolean }) => (
    <LayoutDashboard size={16} color={active ? '#58a6ff' : '#8b949e'} />
  )

  const getTabIcon = (tab: string, active: boolean) => {
    switch (tab) {
      case 'code':
        return <TabIconCode active={active} />
      case 'branches':
        return <TabIconBranches active={active} />
      case 'tags':
        return <TabIconTags active={active} />
      case 'overview':
        return <TabIconOverview active={active} />
      default:
        return null
    }
  }

  /* ═══════ RENDER ═══════ */
  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black">
      {/* ── Header ── */}
      <View className="flex-row items-center justify-between px-4 pt-14 pb-4 border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} className="p-2">
          <ChevronLeft size={24} color="#58a6ff" />
        </TouchableOpacity>
        <View className="flex-1 items-center">
          <Text className="text-black dark:text-neutral-100 text-lg font-bold">
            {name}
          </Text>
          <Text className="text-neutral-500 text-xs">{repoSize}</Text>
        </View>
        <TouchableOpacity onPress={handleDeleteRepo} className="p-2">
          <Trash2 size={20} color="#f85149" />
        </TouchableOpacity>
      </View>

      {/* ── Branch selector & Actions ── */}
      <View className="px-4 py-3 bg-white dark:bg-zinc-900 border-b border-neutral-200 dark:border-zinc-800">
        <View className="flex-row items-center mb-3">
          <TouchableOpacity
            className="flex-row items-center px-3 py-2 rounded-lg bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800 "
            onPress={() => setShowBranchPicker(!showBranchPicker)}
          >
            <GitBranch size={14} color="#58a6ff" className="mr-1.5" />
            <Text className="text-black dark:text-neutral-100 text-sm font-semibold mr-1.5">
              {branch}
            </Text>
            <ChevronDown size={14} color="#8b949e" />
          </TouchableOpacity>
          <View className="flex-row ml-4 gap-3 flex-1">
            <Text className="text-neutral-500 text-xs font-medium">
              {branches.length} branch{branches.length !== 1 ? 'es' : ''}
            </Text>
            <Text className="text-neutral-500 text-xs font-medium">
              {tags.length} tag{tags.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
          <TouchableOpacity
            className="flex-row items-center px-3 py-2 rounded-lg bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800 "
            onPress={() =>
              router.push({
                pathname: '/repo/[name]/graph' as any,
                params: { name },
              })
            }
          >
            <Share2 size={14} color="#d2a8ff" className="mr-1.5" />
            <Text className="text-[#d2a8ff] text-xs font-semibold">Graph</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-row items-center px-3 py-2 rounded-lg bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800"
            onPress={() =>
              router.push({
                pathname: '/repo/[name]/analytics' as any,
                params: { name },
              })
            }
          >
            <BarChart3 size={14} color="#58a6ff" className="mr-1.5" />
            <Text className="text-[#58a6ff] text-xs font-semibold">Analytics</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-row items-center px-3 py-2 rounded-lg bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800"
            onPress={() =>
              router.push({
                pathname: '/repo/[name]/health' as any,
                params: { name },
              })
            }
          >
            <ShieldCheck size={14} color="#3fb950" className="mr-1.5" />
            <Text className="text-[#3fb950] text-xs font-semibold">Health</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Branch picker dropdown */}
      {showBranchPicker && (
        <View className="mx-4 mt-2 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 z-10 absolute top-[135px] left-0 right-0 max-h-[300px] ">
          <ScrollView>
            <View className="px-4 py-3 bg-neutral-50 dark:bg-black border-b border-neutral-200 dark:border-zinc-800 rounded-t-xl">
              <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider">
                Switch branches
              </Text>
            </View>
            {branches.map((b) => (
              <TouchableOpacity
                key={b}
                className="px-4 py-3.5 border-b border-neutral-100 dark:border-zinc-800 flex-row items-center justify-between"
                onPress={() => handleCheckout(b)}
              >
                <View className="flex-row items-center gap-3">
                  {b === branch ? (
                    <Check size={16} color="#58a6ff" />
                  ) : (
                    <View className="w-4 h-4" />
                  )}
                  <Text
                    className={
                      b === branch
                        ? 'text-[#58a6ff] font-semibold text-sm'
                        : 'text-black dark:text-neutral-200 text-sm'
                    }
                  >
                    {b}
                  </Text>
                </View>
                {b === branch && (
                  <View className="px-2 py-1 rounded-full bg-[#1f6feb22]">
                    <Text className="text-[#58a6ff] text-[10px] font-bold uppercase">
                      curr
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Tab bar (GitHub-style) ── */}
      <View className="flex-row border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2">
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            className="flex-1 flex-row items-center justify-center gap-2 py-3.5"
            onPress={() => {
              setActiveTab(tab)
              setShowBranchPicker(false)
            }}
          >
            {getTabIcon(tab, activeTab === tab)}
            <Text
              className={
                activeTab === tab
                  ? 'text-black dark:text-white text-sm font-semibold'
                  : 'text-neutral-500 text-sm font-medium'
              }
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
            {activeTab === tab && (
              <View className="absolute bottom-[-1px] left-4 right-4 h-[2px] bg-[#f78166]" />
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
                <View className="flex-row items-center mb-3 justify-between">
                  <View className="flex-row items-center gap-2 flex-1">
                    <TouchableOpacity
                      onPress={() => {
                        setViewingFile(null)
                        setFileContent('')
                      }}
                      className="p-1 rounded bg-neutral-100 dark:bg-zinc-800"
                    >
                      <ChevronLeft size={20} color="#58a6ff" />
                    </TouchableOpacity>
                    <Text
                      className="text-black dark:text-neutral-100 text-sm font-semibold flex-1"
                      numberOfLines={1}
                    >
                      {viewingFile.split('/').pop()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleEditFile(viewingFile)}
                    className="px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-zinc-800 border border-neutral-200 dark:border-zinc-700 ml-2"
                  >
                    <Text className="text-[#58a6ff] text-xs font-semibold">
                      Edit
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Breadcrumb */}
                <View className="flex-row flex-wrap mb-4 px-1">
                  {viewingFile.split('/').map((seg, i, arr) => (
                    <Text
                      key={i}
                      className="text-neutral-500 text-xs font-medium"
                    >
                      {i > 0 && <Text className="text-neutral-400"> / </Text>}
                      <Text
                        className={
                          i === arr.length - 1
                            ? 'text-black dark:text-neutral-200 font-bold'
                            : 'text-[#58a6ff]'
                        }
                      >
                        {seg}
                      </Text>
                    </Text>
                  ))}
                </View>

                {loadingFile ? (
                  <ActivityIndicator color="#58a6ff" className="mt-8" />
                ) : (
                  <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                    {/* File header */}
                    <View className="flex-row items-center justify-between px-4 py-3 bg-neutral-50 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
                      <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider">
                        {fileContent.split('\n').length} lines
                      </Text>
                      <Text className="text-neutral-500 text-xs font-semibold">
                        {branch}
                      </Text>
                    </View>
                    {/* Code lines with syntax highlighting */}
                    <ScrollView horizontal>
                      <View className="p-4 bg-white dark:bg-black">
                        <SyntaxHighlighter
                          code={fileContent}
                          filename={viewingFile}
                          showLineNumbers
                          fontSize={12}
                        />
                      </View>
                    </ScrollView>
                  </View>
                )}
              </>
            ) : (
              /* File tree */
              <>
                {/* Breadcrumb nav */}
                <View className="flex-row items-center mb-3 flex-wrap ml-1">
                  <TouchableOpacity onPress={() => setTreePath([])}>
                    <Text className="text-[#58a6ff] text-sm font-bold">
                      {name}
                    </Text>
                  </TouchableOpacity>
                  {treePath.map((seg, i) => (
                    <View key={i} className="flex-row items-center">
                      <Text className="text-neutral-400 text-sm mx-1.5">/</Text>
                      <TouchableOpacity
                        onPress={() => setTreePath(treePath.slice(0, i + 1))}
                      >
                        <Text className="text-[#58a6ff] text-sm font-semibold">
                          {seg}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                {/* Last commit banner */}
                {commits.length > 0 && (
                  <View className="rounded-t-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 px-4 py-3 flex-row items-center ">
                    <View className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-zinc-800 mr-3 items-center justify-center">
                      <Text className="text-neutral-700 dark:text-neutral-300 text-[10px] font-bold">
                        {commits[0].author.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text
                      className="text-black dark:text-neutral-200 text-xs font-medium flex-1"
                      numberOfLines={1}
                    >
                      {commits[0].message.trim()}
                    </Text>
                    <Text className="text-neutral-500 text-[10px] ml-2 font-medium bg-neutral-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                      {timeAgo(commits[0].timestamp)}
                    </Text>
                  </View>
                )}

                {/* File listing */}
                <View
                  className={`bg-white dark:bg-zinc-900 border-x border-b border-neutral-200 dark:border-zinc-800 ${commits.length === 0 ? 'rounded-t-xl border-t' : ''} rounded-b-xl overflow-hidden `}
                >
                  {treePath.length > 0 && (
                    <TouchableOpacity
                      className="flex-row items-center px-4 py-3.5 border-b border-neutral-100 dark:border-zinc-800"
                      onPress={() =>
                        setTreePath(treePath.slice(0, treePath.length - 1))
                      }
                    >
                      <Text className="text-[#58a6ff] text-sm font-bold ml-1">
                        ..
                      </Text>
                    </TouchableOpacity>
                  )}
                  {currentLevel.length === 0 ? (
                    <View className="px-4 py-8 items-center">
                      <Text className="text-neutral-500 text-sm font-medium">
                        No files at this ref
                      </Text>
                    </View>
                  ) : (
                    currentLevel.map((node, index) => (
                      <TouchableOpacity
                        key={node.path}
                        className={`flex-row items-center px-4 py-3.5 ${index < currentLevel.length - 1 || treePath.length > 0 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                        onPress={() => {
                          if (node.type === 'dir') {
                            setTreePath([...treePath, node.name])
                          } else {
                            handleOpenFile(node.path)
                          }
                        }}
                      >
                        <View className="w-6 items-center justify-center mr-3">
                          {node.type === 'dir' ? (
                            <FolderGit2 size={18} color="#58a6ff" />
                          ) : (
                            getFileIcon(node.name)
                          )}
                        </View>
                        <Text
                          className={
                            node.type === 'dir'
                              ? 'text-black dark:text-neutral-200 text-sm flex-1 font-semibold'
                              : 'text-neutral-700 dark:text-neutral-300 text-sm flex-1 font-medium'
                          }
                          numberOfLines={1}
                        >
                          {node.name}
                        </Text>
                        {node.type === 'dir' && (
                          <ChevronRight size={16} color="#8b949e" />
                        )}
                      </TouchableOpacity>
                    ))
                  )}
                </View>

                {/* Quick stats */}
                <View className="flex-row gap-4 mt-4 ml-1">
                  <View className="flex-row items-center gap-1.5">
                    <History size={14} color="#8b949e" />
                    <Text className="text-neutral-500 text-xs font-medium">
                      {commits.length} commit{commits.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  {modFiles.length > 0 && (
                    <View className="flex-row items-center gap-1.5">
                      <Circle size={10} color="#d29922" fill="#d29922" />
                      <Text className="text-[#d29922] text-xs font-medium">
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
              className="py-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row justify-center items-center gap-2 mb-4 "
              onPress={() => setShowNewBranch(!showNewBranch)}
            >
              <Plus size={16} color="#58a6ff" />
              <Text className="text-[#58a6ff] text-sm font-bold">
                New Branch
              </Text>
            </TouchableOpacity>

            {showNewBranch && (
              <View className="mb-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4 ">
                <Text className="text-neutral-500 text-xs font-semibold mb-3">
                  Create from{' '}
                  <Text className="text-black dark:text-neutral-100 font-bold">
                    {branch}
                  </Text>
                </Text>
                <View className="flex-row gap-2">
                  <TextInput
                    className="flex-1 bg-neutral-50 dark:bg-black text-black dark:text-neutral-100 px-3 py-2.5 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
                    value={newBranchName}
                    onChangeText={setNewBranchName}
                    placeholder="feature/my-branch"
                    placeholderTextColor="#8b949e"
                    autoFocus
                  />
                  <TouchableOpacity
                    className="px-4 py-2.5 rounded-md bg-[#1f6feb] justify-center "
                    onPress={handleCreateBranch}
                  >
                    <Text className="text-white text-sm font-bold">Create</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Default branch */}
            <View className="mb-2 ml-1">
              <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider mb-2">
                Branches
              </Text>
            </View>

            {/* Branch list */}
            <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
              {branches.map((b, idx) => (
                <View
                  key={b}
                  className={`px-4 py-3.5 ${idx < branches.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                >
                  <View className="flex-row items-center justify-between">
                    <TouchableOpacity
                      className="flex-1 flex-row items-center gap-3"
                      onPress={() => handleCheckout(b)}
                    >
                      <GitBranch
                        size={16}
                        color={b === branch ? '#58a6ff' : '#8b949e'}
                      />
                      <Text
                        className={
                          b === branch
                            ? 'text-[#58a6ff] font-semibold text-sm'
                            : 'text-neutral-700 dark:text-neutral-300 text-sm font-medium'
                        }
                      >
                        {b}
                      </Text>
                      {b === branch && (
                        <View className="px-2 py-0.5 rounded-full bg-[#1f6feb22]">
                          <Text className="text-[#58a6ff] text-[10px] font-bold uppercase tracking-wider">
                            Active
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Branch action buttons */}
                  <View className="flex-row gap-2 mt-3 flex-wrap">
                    {b !== branch && (
                      <>
                        <TouchableOpacity
                          className="px-3 py-1.5 rounded-md bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800"
                          onPress={() => handleCheckout(b)}
                        >
                          <Text className="text-neutral-700 dark:text-neutral-300 text-xs font-medium">
                            Checkout
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="px-3 py-1.5 rounded-md bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800"
                          onPress={() => handleMerge(b)}
                          disabled={merging}
                        >
                          <Text className="text-neutral-700 dark:text-neutral-300 text-xs font-medium">
                            {merging ? 'Merging...' : 'Merge'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="px-3 py-1.5 rounded-md bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800"
                          onPress={() => handleCompare(b)}
                        >
                          <Text className="text-[#58a6ff] text-xs font-medium">
                            Compare
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="px-3 py-1.5 rounded-md bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800"
                          onPress={() => handleRebase(b)}
                        >
                          <Text className="text-[#d2a8ff] text-xs font-medium">
                            Rebase
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="px-3 py-1.5 rounded-md bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800"
                          onPress={() => handleDeleteBranch(b)}
                        >
                          <Text className="text-[#f85149] text-xs font-medium">
                            Delete
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              ))}
            </View>

            {/* Compare modal */}
            {showCompare && compareBranch && (
              <View className="mt-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                <View className="flex-row items-center justify-between px-4 py-3 bg-neutral-100 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
                  <Text className="text-black dark:text-neutral-100 text-sm font-semibold">
                    Comparing: {branch} ← {compareBranch}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowCompare(false)
                      setCompareResults(null)
                    }}
                  >
                    <ChevronDown size={20} color="#8b949e" />
                  </TouchableOpacity>
                </View>
                {loadingCompare ? (
                  <View className="py-6 items-center">
                    <ActivityIndicator color="#58a6ff" />
                  </View>
                ) : compareResults && compareResults.length === 0 ? (
                  <View className="px-4 py-6 items-center">
                    <Text className="text-[#7ee787] text-sm font-bold">
                      ✓ Branches are identical
                    </Text>
                  </View>
                ) : (
                  <View>
                    <View className="px-4 py-3 border-b border-neutral-100 dark:border-zinc-800">
                      <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider">
                        {compareResults?.length ?? 0} file
                        {(compareResults?.length ?? 0) !== 1 ? 's' : ''} changed
                      </Text>
                    </View>
                    {compareResults?.map((f) => (
                      <View
                        key={f.filepath}
                        className="flex-row items-center px-4 py-3 border-b border-neutral-100 dark:border-zinc-800"
                      >
                        <Text
                          className="text-[11px] font-extrabold w-6 text-center "
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
                          className="text-black dark:text-neutral-200 text-xs font-medium flex-1"
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
              className="mt-4 py-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center "
              onPress={() =>
                router.push({
                  pathname: '/repo/[name]/compare' as any,
                  params: { name },
                })
              }
            >
              <Text className="text-[#58a6ff] text-sm font-bold">
                Open Full Compare View →
              </Text>
            </TouchableOpacity>
          </View>
        ) : activeTab === 'tags' ? (
          /* ──────────── TAGS TAB ──────────── */
          <View className="px-4 mt-3">
            <TouchableOpacity
              className="py-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row justify-center items-center gap-2 mb-4 "
              onPress={() => setShowTagInput(!showTagInput)}
            >
              <Plus size={16} color="#58a6ff" />
              <Text className="text-[#58a6ff] text-sm font-bold">New Tag</Text>
            </TouchableOpacity>

            {showTagInput && (
              <View className="mb-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4 ">
                <Text className="text-neutral-500 text-xs font-semibold mb-3">
                  Tag at HEAD (
                  <Text className="text-black dark:text-neutral-100 font-bold">
                    {branch}
                  </Text>
                  )
                </Text>
                <View className="flex-row gap-2">
                  <TextInput
                    className="flex-1 bg-neutral-50 dark:bg-black text-black dark:text-neutral-100 px-3 py-2.5 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
                    value={newTagName}
                    onChangeText={setNewTagName}
                    placeholder="v1.0.0"
                    placeholderTextColor="#8b949e"
                    autoFocus
                  />
                  <TouchableOpacity
                    className="px-4 py-2.5 rounded-md bg-[#1f6feb] justify-center "
                    onPress={handleCreateTag}
                  >
                    <Text className="text-white text-sm font-bold">Create</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
              {tags.length === 0 ? (
                <View className="px-4 py-8 items-center">
                  <Text className="text-neutral-500 text-sm font-semibold">
                    No tags yet
                  </Text>
                  <Text className="text-neutral-400 text-xs mt-1.5 text-center">
                    Tags mark specific points in history
                  </Text>
                </View>
              ) : (
                tags.map((t, idx) => (
                  <View
                    key={t}
                    className={`flex-row items-center justify-between px-4 py-4 ${idx < tags.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                  >
                    <View className="flex-row items-center gap-3">
                      <Tag size={16} color="#8b949e" />
                      <Text className="text-neutral-700 dark:text-neutral-300 font-medium text-sm">
                        {t}
                      </Text>
                    </View>
                    <TouchableOpacity
                      className="px-3 py-1.5 rounded-md bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800"
                      onPress={() => handleDeleteTag(t)}
                    >
                      <Text className="text-[#f85149] text-xs font-semibold">
                        Delete
                      </Text>
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
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 py-3.5 rounded-xl bg-[#1f6feb] items-center "
                onPress={handleCommit}
                disabled={committing}
              >
                {committing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text className="text-white text-sm font-bold">
                    Commit All
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                className="py-3.5 px-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center justify-center "
                onPress={handleStash}
              >
                <Text className="text-neutral-700 dark:text-neutral-300 text-sm font-semibold">
                  Stash
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="py-3.5 px-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center justify-center "
                onPress={handleStashPop}
              >
                <Text className="text-neutral-700 dark:text-neutral-300 text-sm font-semibold">
                  Pop
                </Text>
              </TouchableOpacity>
            </View>

            {/* GitHub Sync & Collaborators */}
            {ghLinked && (
              <View className="mt-4">
                {/* Add Collaborator UI */}
                <View className="mb-4">
                  <Text className="text-neutral-500 text-xs font-bold mb-2">Add Collaborator</Text>
                  <View className="flex-row gap-2">
                    <TextInput
                      className="flex-1 bg-neutral-50 dark:bg-black text-black dark:text-neutral-100 px-3 py-2.5 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
                      value={collabUsername}
                      onChangeText={setCollabUsername}
                      placeholder="GitHub username"
                      placeholderTextColor="#8b949e"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      className="px-4 py-2.5 rounded-md bg-[#2ea043] justify-center"
                      onPress={handleAddCollaborator}
                      disabled={addingCollab}
                    >
                      <Text className="text-white text-sm font-bold">Add</Text>
                    </TouchableOpacity>
                  </View>
                  {collabStatus && (
                    <Text className="text-xs mt-2" style={{ color: collabStatusColor }}>{collabStatus}</Text>
                  )}
                </View>
                {remoteUrl ? (
                  <View>
                    <View className="flex-row items-center mb-2">
                      <Link2 size={12} color="#8b949e" />
                      <Text className="text-neutral-500 text-[11px] ml-1 flex-1" numberOfLines={1}>
                        {remoteUrl}
                      </Text>
                      {!isOnline() && (
                        <Text className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded font-medium ml-1">
                          offline
                        </Text>
                      )}
                    </View>
                    {/* Sync button (fetch → pull if needed → push) */}
                    <TouchableOpacity
                      className="py-3 rounded-xl bg-[#58a6ff] items-center flex-row justify-center gap-2 mb-2"
                      onPress={handleSync}
                      disabled={syncing !== null}
                    >
                      {syncing !== null ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <RefreshCw size={14} color="#fff" />
                          <Text className="text-white text-sm font-bold">Sync</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <View className="flex-row gap-2">
                      <TouchableOpacity
                        className="flex-1 py-3 rounded-xl bg-[#2ea043] items-center flex-row justify-center gap-2"
                        onPress={handlePush}
                        disabled={syncing !== null}
                      >
                        {syncing === 'push' ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <>
                            <ArrowUpFromLine size={14} color="#fff" />
                            <Text className="text-white text-sm font-bold">Push</Text>
                          </>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="flex-1 py-3 rounded-xl bg-[#1f6feb] items-center flex-row justify-center gap-2"
                        onPress={handlePull}
                        disabled={syncing !== null}
                      >
                        {syncing === 'pull' ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <>
                            <ArrowDownToLine size={14} color="#fff" />
                            <Text className="text-white text-sm font-bold">Pull</Text>
                          </>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="py-3 px-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center justify-center"
                        onPress={handleFetch}
                        disabled={syncing !== null}
                      >
                        {syncing === 'fetch' ? (
                          <ActivityIndicator color="#58a6ff" size="small" />
                        ) : (
                          <RefreshCw size={16} color="#8b949e" />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View>
                    {/* Publish to GitHub */}
                    <TouchableOpacity
                      className="py-3 mb-2 rounded-xl bg-[#2ea043] items-center flex-row justify-center gap-2"
                      onPress={async () => {
                        if (!name) return
                        setPublishing(true)
                        try {
                          const ghRepo = await createGitHubRepo(name, { isPrivate: true })
                          await addRemote(name, 'origin', ghRepo.clone_url)
                          setRemoteUrl(ghRepo.clone_url)
                          if (isOnline()) {
                            try {
                              await pushRemote(name)
                            } catch { /* may fail if empty repo */ }
                          }
                          Alert.alert('Published!', `Created ${ghRepo.full_name} on GitHub`)
                          await loadRepoData()
                        } catch (err: any) {
                          Alert.alert('Publish failed', err?.message ?? 'Could not create repo on GitHub')
                        } finally {
                          setPublishing(false)
                        }
                      }}
                      disabled={publishing}
                    >
                      {publishing ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Github size={14} color="#fff" />
                          <Text className="text-white text-sm font-bold">Publish to GitHub</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {/* Or add custom remote */}
                    {showAddRemote ? (
                      <View>
                        <TextInput
                          className="bg-white dark:bg-black text-black dark:text-white px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-zinc-800 text-sm"
                          placeholder="https://github.com/user/repo.git"
                          placeholderTextColor="#8b949e"
                          value={newRemoteUrl}
                          onChangeText={setNewRemoteUrl}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <View className="flex-row gap-2 mt-2">
                          <TouchableOpacity
                            className="flex-1 py-2.5 rounded-lg bg-[#2ea043] items-center"
                            onPress={handleAddRemote}
                          >
                            <Text className="text-white text-sm font-semibold">Add Remote</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            className="py-2.5 px-4 rounded-lg bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800"
                            onPress={() => setShowAddRemote(false)}
                          >
                            <Text className="text-neutral-500 text-sm">Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        className="py-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center flex-row justify-center gap-2"
                        onPress={() => setShowAddRemote(true)}
                      >
                        <Link2 size={14} color="#8b949e" />
                        <Text className="text-neutral-500 text-sm font-medium">Add Remote Origin</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Commit message */}
            <TextInput
              className="mt-4 bg-white dark:bg-black text-black dark:text-neutral-100 px-4 py-3.5 rounded-xl border border-neutral-200 dark:border-zinc-800 text-sm "
              placeholder="Commit message (auto-generated if empty)"
              placeholderTextColor="#8b949e"
              value={commitMsg}
              onChangeText={setCommitMsg}
            />

            {/* Status summary */}
            <View className="mt-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
              <View className="px-4 py-3 bg-neutral-50 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
                <Text
                  className={
                    modFiles.length === 0
                      ? 'text-[#7ee787] text-sm font-bold'
                      : 'text-black dark:text-neutral-100 text-sm font-bold'
                  }
                >
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
                      className="flex-row items-center px-4 py-3 border-b border-neutral-100 dark:border-zinc-800"
                      onPress={() => handleEditFile(f.filepath)}
                    >
                      <Text
                        className="text-[11px] font-extrabold w-6 text-center"
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
                        className="text-black dark:text-neutral-200 text-xs font-medium flex-1 ml-1"
                        numberOfLines={1}
                      >
                        {f.filepath}
                      </Text>
                      <ChevronRight size={14} color="#8b949e" />
                    </TouchableOpacity>
                  ))}
                  {modFiles.length > 10 && (
                    <View className="px-4 py-3">
                      <Text className="text-neutral-500 text-xs font-medium italic">
                        +{modFiles.length - 10} more files
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Recent Commits */}
            <View className="mt-5">
              <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider mb-2 ml-1">
                Recent Commits
              </Text>
              <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                {commits.length === 0 ? (
                  <View className="px-4 py-8 items-center">
                    <Text className="text-neutral-500 text-sm font-medium">
                      No commits yet
                    </Text>
                  </View>
                ) : (
                  commits.slice(0, 8).map((c, idx) => (
                    <View
                      key={c.oid}
                      className={`flex-row items-start px-4 py-3.5 ${idx < Math.min(commits.length, 8) - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                    >
                      <View className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-zinc-800 mr-3.5 items-center justify-center">
                        <Text className="text-neutral-700 dark:text-neutral-300 text-xs font-bold">
                          {c.author.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View className="flex-1 mt-0.5">
                        <Text
                          className="text-black dark:text-neutral-100 text-sm font-medium leading-tight mb-1"
                          numberOfLines={2}
                        >
                          {c.message.trim()}
                        </Text>
                        <Text className="text-neutral-500 text-[11px] font-medium mt-0.5">
                          {c.author} committed{' '}
                          <Text className="text-neutral-400 font-mono">
                            {c.oid.slice(0, 7)}
                          </Text>
                        </Text>
                        <View className="flex-row items-center mt-1">
                          <Clock size={10} color="#8b949e" />
                          <Text className="text-neutral-400 text-[10px] ml-1">
                            {timeAgo(c.timestamp)}
                          </Text>
                        </View>
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
