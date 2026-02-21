import { useCallback, useMemo, useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Upload, FlaskConical, Settings, Plus, Download, FolderGit2, Folder as FolderClosed, ChevronRight, Github, RefreshCw, Wifi, WifiOff, CloudUpload, Check } from 'lucide-react-native'

import {
  currentBranch,
  getStatus,
  initRepo,
  duplicateRepo,
  cloneFromGitHub,
  getRemoteUrl,
  getRemoteDivergence,
  addRemote,
  pushRemote,
  stageAll,
  commitAll,
} from '@/services/gitService'
import { quickBrowseClone } from '@/services/quickBrowseService'
import { isGitHubLinked, listGitHubRepos, createGitHubRepo, getCachedUsername } from '@/services/githubAuth'
// import removed: isOnline as checkOnline
import {
  getRepoSize,
  listRepos,
  deleteRepo,
  renameRepo,
} from '@/services/repoService'
import { isOnline, onConnectivityChange } from '@/services/networkService'
import {
  getPendingCount,
  syncAll,
  getLastSyncInfo,
  onSyncEvent,
} from '@/services/offlineSyncService'

type RepoCard = {
  name: string
  branch: string
  statusText: 'Modified' | 'Clean'
  statusColor: string
  sizeText: string
  ageText: string
  isGitRepo: boolean
  hasRemote: boolean
  pendingPushes: number
  lastSync: string | null
  ahead: number
  behind: number
}

function formatBytes(bytes: number) {
  if (!bytes) return '0B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value % 1 === 0 ? value : value.toFixed(1)}${units[idx]}`
}

function formatAge(dateMs?: number) {
  if (!dateMs) return 'just now'
  const diff = Date.now() - dateMs
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export default function HomeScreen() {
  const router = useRouter()
  const [repos, setRepos] = useState<RepoCard[]>([])
  const [loading, setLoading] = useState(false)
  const [showInitDialog, setShowInitDialog] = useState(false)
  const [initName, setInitName] = useState('')
  const [showDupDialog, setShowDupDialog] = useState<string | null>(null)
  const [dupName, setDupName] = useState('')
  const [showCloneDialog, setShowCloneDialog] = useState(false)
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneName, setCloneName] = useState('')
  const [cloneLazy, setCloneLazy] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [publishToGH, setPublishToGH] = useState(false)
  const [initPrivate, setInitPrivate] = useState(true)
  const [initDescription, setInitDescription] = useState('')
  const [initCreating, setInitCreating] = useState(false)
  const [ghLinked, setGhLinked] = useState(false)
  const [ghRepos, setGhRepos] = useState<any[]>([])
  const [loadingGhRepos, setLoadingGhRepos] = useState(false)
  const [online, setOnline] = useState(isOnline())
  const [syncing, setSyncing] = useState(false)

  // Track online status
    useEffect(() => {
      // Start network monitor once
      import('@/services/networkService').then((mod) => {
        if (mod.startNetworkMonitor) mod.startNetworkMonitor()
      })
      setOnline(isOnline())
      const unsub = onConnectivityChange((v: boolean) => setOnline(v))
      return unsub
    }, [])

  // Refresh when sync completes
  useEffect(() => {
    const unsub = onSyncEvent('sync-success', () => refreshRepos())
    const unsub2 = onSyncEvent('queue-change', () => refreshRepos())
    return () => { unsub(); unsub2() }
  }, [])

  const refreshRepos = useCallback(async () => {
    setLoading(true)
    try {
      const basicRepos = await listRepos()
      const cards: RepoCard[] = await Promise.all(
        basicRepos.map(async (repo) => {
          const [branch, statuses, size, remoteUrl, pending, syncInfo] = await Promise.all([
            repo.isGitRepo ? currentBranch(repo.name).catch(() => null) : null,
            repo.isGitRepo ? getStatus(repo.name).catch(() => []) : [],
            getRepoSize(repo.name).catch(() => 0),
            repo.isGitRepo ? getRemoteUrl(repo.name).catch(() => null) : null,
            repo.isGitRepo ? getPendingCount(repo.name).catch(() => 0) : 0,
            repo.isGitRepo ? getLastSyncInfo(repo.name).catch(() => null) : null,
          ])

          let ahead = 0, behind = 0
          if (remoteUrl && repo.isGitRepo) {
            try {
              const div = await getRemoteDivergence(repo.name, branch)
              ahead = div.ahead
              behind = div.behind
            } catch { /* ignore */ }
          }

          const isModified = statuses.some(
            (item: any) => item.status !== 'unmodified',
          )

          return {
            name: repo.name,
            branch: branch ?? 'main',
            statusText: isModified ? 'Modified' : 'Clean',
            statusColor: isModified ? '#d29922' : '#7ee787',
            sizeText: formatBytes(size),
            ageText: syncInfo?.lastSync ? formatAge(new Date(syncInfo.lastSync).getTime()) : formatAge(),
            isGitRepo: repo.isGitRepo,
            hasRemote: !!remoteUrl,
            pendingPushes: pending,
            lastSync: syncInfo?.lastSync ?? null,
            ahead,
            behind,
          }
        }),
      )
      setRepos(cards)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      refreshRepos()
      isGitHubLinked().then(setGhLinked).catch(() => setGhLinked(false))
    }, [refreshRepos]),
  )

  const repoCountLabel = useMemo(
    () => `${repos.length} repo${repos.length === 1 ? '' : 's'}`,
    [repos.length],
  )

  const handleInit = useCallback(async () => {
    const repoName =
      initName.trim() || `Repo-${Date.now().toString().slice(-5)}`
    setInitCreating(true)
    try {
      // 1. Create local repo
      await initRepo(repoName)

      // 2. Create an initial commit so we have something to push
      try {
        await stageAll(repoName)
        await commitAll(repoName, 'Initial commit')
      } catch { /* empty repo — no files to commit, that's fine */ }

      // 3. Optionally create on GitHub and push
      if (publishToGH && ghLinked) {
        try {
          const ghRepo = await createGitHubRepo(repoName, {
            description: initDescription.trim(),
            isPrivate: initPrivate,
          })
          await addRemote(repoName, 'origin', ghRepo.clone_url)
          if (isOnline()) {
            await pushRemote(repoName)
          }
          Alert.alert('Created!', `${repoName} published to GitHub${initPrivate ? ' (private)' : ''}`)
        } catch (ghErr: any) {
          // Local repo still created
          Alert.alert(
            'Local repo created',
            `But GitHub publish failed: ${ghErr?.message ?? 'Unknown error'}\n\nYou can push later from the repo page.`,
          )
        }
      }
      setShowInitDialog(false)
      setInitName('')
      setInitDescription('')
      setPublishToGH(false)
      await refreshRepos()
    } catch (err: any) {
      Alert.alert('Init failed', err?.message ?? 'Could not initialize repo.')
    } finally {
      setInitCreating(false)
    }
  }, [initName, publishToGH, ghLinked, initPrivate, initDescription, refreshRepos])

  const handleDelete = useCallback(
    (repoName: string) => {
      Alert.alert('Delete Repository', `Permanently delete "${repoName}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteRepo(repoName)
              await refreshRepos()
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Delete failed')
            }
          },
        },
      ])
    },
    [refreshRepos],
  )

  const handleDuplicate = useCallback(async () => {
    if (!showDupDialog) return
    const newName = dupName.trim() || `${showDupDialog}-copy`
    try {
      await duplicateRepo(showDupDialog, newName)
      setShowDupDialog(null)
      setDupName('')
      Alert.alert('Duplicated', `"${showDupDialog}" → "${newName}"`)
      await refreshRepos()
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Duplicate failed')
    }
  }, [showDupDialog, dupName, refreshRepos])

  const handleClone = useCallback(async () => {
    if (!cloneUrl.trim()) {
      Alert.alert('Error', 'Please enter a repository URL')
      return
    }
    // Derive name from URL if not provided
    const repoName = cloneName.trim() || cloneUrl.trim().split('/').pop()?.replace('.git', '') || `clone-${Date.now()}`
    setCloning(true)
    try {
      if (cloneLazy) {
        // Quick Browse: fetch tree from GitHub API only — zero git data downloaded
        await quickBrowseClone(cloneUrl.trim(), repoName)
        Alert.alert('Quick Browse Ready!', `"${repoName}" — browse files, tap to download only what you need.`)
      } else {
        // Normal git clone
        await cloneFromGitHub(cloneUrl.trim(), repoName)
        Alert.alert('Cloned!', `"${repoName}" is ready`)
      }
      setShowCloneDialog(false)
      setCloneUrl('')
      setCloneName('')
      setCloneLazy(false)
      await refreshRepos()
    } catch (err: any) {
      Alert.alert('Clone failed', err?.message ?? 'Could not clone')
    } finally {
      setCloning(false)
    }
  }, [cloneUrl, cloneName, cloneLazy, refreshRepos])

  const handleOpenCloneDialog = useCallback(async () => {
    setShowCloneDialog(true)
    setCloneUrl('')
    setCloneName('')
    if (ghLinked) {
      setLoadingGhRepos(true)
      try {
        const repos = await listGitHubRepos({ maxPages: 3 })
        setGhRepos(repos)
      } catch {
        setGhRepos([])
      } finally {
        setLoadingGhRepos(false)
      }
    }
  }, [ghLinked])

  const handleSyncAll = useCallback(async () => {
    if (!online) {
      Alert.alert('Offline', 'Sync will happen automatically when you come back online.')
      return
    }
    setSyncing(true)
    try {
      const repoNames = repos.filter(r => r.hasRemote).map(r => r.name)
      if (repoNames.length === 0) {
        Alert.alert('No remotes', 'No repos with a remote origin to sync.')
        return
      }
      const results = await syncAll(repoNames)
      const summary = Object.entries(results)
        .map(([name, r]: any) => `${name}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`)
        .join('\n')
      Alert.alert('Sync Complete', summary)
      await refreshRepos()
    } catch (err: any) {
      Alert.alert('Sync failed', err?.message ?? 'Unknown error')
    } finally {
      setSyncing(false)
    }
  }, [online, repos, refreshRepos])

  const showRepoActions = useCallback(
    (repoName: string) => {
      Alert.alert(repoName, 'Choose an action', [
        {
          text: 'Open',
          onPress: () =>
            router.push({
              pathname: '/repo/[name]',
              params: { name: repoName },
            } as any),
        },
        {
          text: 'Duplicate',
          onPress: () => {
            setShowDupDialog(repoName)
            setDupName(`${repoName}-copy`)
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handleDelete(repoName),
        },
        { text: 'Cancel', style: 'cancel' },
      ])
    },
    [router, handleDelete],
  )

  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black w-full">
      <View className="px-5 pt-6 pb-4 border-b border-neutral-200 dark:border-zinc-800 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-black dark:text-neutral-100 text-5xl font-extrabold">GitLane</Text>
          {/* Online/offline indicator */}
          <View className={`w-2.5 h-2.5 rounded-full mt-2 ${online ? 'bg-green-500' : 'bg-red-500'}`} />
        </View>
        <View className="flex-row items-center gap-3">
          {ghLinked && (
            <TouchableOpacity
              className="w-9 h-9 rounded-full bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center justify-center"
              onPress={handleSyncAll}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator size={16} color="#58a6ff" />
              ) : (
                <RefreshCw size={18} color={online ? '#58a6ff' : '#8b949e'} strokeWidth={2.5} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center justify-center"
            onPress={() => router.push('/transfer')}
          >
            <Upload size={18} color="#8b949e" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center justify-center"
            onPress={() => router.push('/testing')}
          >
            <FlaskConical size={18} color="#8b949e" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center justify-center"
            onPress={() => router.push('/settings')}
          >
            <Settings size={18} color="#8b949e" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      </View>

      <View className="px-5 pt-4 flex-row gap-3">
        <TouchableOpacity
          className="flex-1 py-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row justify-center gap-2 items-center"
          onPress={() => {
            setShowInitDialog(true)
            setInitName('')
          }}
        >
          <Plus size={20} color="#8b949e" />
          <Text className="text-black dark:text-neutral-100 text-base font-bold">Init</Text>
        </TouchableOpacity>
        {ghLinked && (
          <TouchableOpacity
            className="flex-1 py-3.5 rounded-xl bg-[#2ea043] flex-row justify-center gap-2 items-center"
            onPress={handleOpenCloneDialog}
          >
            <Github size={20} color="#fff" />
            <Text className="text-white text-base font-bold">Clone</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          className="flex-1 py-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row justify-center gap-2 items-center"
          onPress={() => router.push('/transfer')}
        >
          <Download size={20} color="#8b949e" />
          <Text className="text-black dark:text-neutral-100 text-base font-bold">Import</Text>
        </TouchableOpacity>
      </View>

      {/* Init repo dialog */}
      {showInitDialog && (
        <View className="mx-5 mt-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4 relative z-50">
          <Text className="text-neutral-900 dark:text-white text-sm font-semibold mb-2">
            New Repository
          </Text>
          <TextInput
            className="bg-neutral-50 dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
            value={initName}
            onChangeText={setInitName}
            placeholder="repository-name"
            placeholderTextColor="#8b949e"
            autoFocus
          />

          {/* Publish to GitHub toggle */}
          {ghLinked && (
            <View className="mt-3">
              <TouchableOpacity
                className="flex-row items-center gap-2"
                onPress={() => setPublishToGH((v) => !v)}
              >
                <View
                  className={`w-5 h-5 rounded border items-center justify-center ${
                    publishToGH
                      ? 'bg-[#2ea043] border-[#2ea043]'
                      : 'border-neutral-300 dark:border-zinc-700'
                  }`}
                >
                  {publishToGH && (
                    <Text className="text-white text-xs font-bold">✓</Text>
                  )}
                </View>
                <Github size={16} color={publishToGH ? '#2ea043' : '#8b949e'} />
                <Text className="text-black dark:text-white text-sm font-medium">
                  Publish to GitHub
                </Text>
              </TouchableOpacity>

              {publishToGH && (
                <View className="mt-2 ml-7">
                  <TextInput
                    className="bg-neutral-50 dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
                    value={initDescription}
                    onChangeText={setInitDescription}
                    placeholder="Description (optional)"
                    placeholderTextColor="#8b949e"
                  />
                  <TouchableOpacity
                    className="flex-row items-center gap-2 mt-2"
                    onPress={() => setInitPrivate((v) => !v)}
                  >
                    <View
                      className={`w-5 h-5 rounded border items-center justify-center ${
                        initPrivate
                          ? 'bg-[#1f6feb] border-[#1f6feb]'
                          : 'border-neutral-300 dark:border-zinc-700'
                      }`}
                    >
                      {initPrivate && (
                        <Text className="text-white text-xs font-bold">✓</Text>
                      )}
                    </View>
                    <Text className="text-black dark:text-white text-sm">
                      Private repository
                    </Text>
                  </TouchableOpacity>
                  {!online && (
                    <Text className="text-amber-600 text-xs mt-1.5">
                      You're offline — repo will be created locally. Push to GitHub when back online.
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          <View className="flex-row gap-2 mt-3">
            <TouchableOpacity
              className={`flex-1 py-2.5 rounded-md items-center flex-row justify-center gap-2 ${
                publishToGH ? 'bg-[#2ea043]' : 'bg-[#1f6feb]'
              }`}
              onPress={handleInit}
              disabled={initCreating}
            >
              {initCreating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  {publishToGH && <Github size={14} color="#fff" />}
                  <Text className="text-white text-sm font-semibold">
                    {publishToGH ? 'Create & Publish' : 'Create'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              className="py-2 px-4 rounded-md bg-neutral-100 dark:bg-zinc-900 items-center justify-center border border-neutral-200 dark:border-zinc-800"
              onPress={() => {
                setShowInitDialog(false)
                setPublishToGH(false)
                setInitDescription('')
              }}
            >
              <Text className="text-neutral-500 text-sm">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Duplicate dialog */}
      {showDupDialog && (
        <View className="mx-5 mt-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4  relative z-50">
          <Text className="text-neutral-900 dark:text-white text-sm font-semibold mb-2">
            Duplicate "{showDupDialog}"
          </Text>
          <TextInput
            className="bg-neutral-50 dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
            value={dupName}
            onChangeText={setDupName}
            placeholder="new-repo-name"
            placeholderTextColor="#8b949e"
            autoFocus
          />
          <View className="flex-row gap-2 mt-3">
            <TouchableOpacity
              className="flex-1 py-2 rounded-md bg-[#1f6feb] items-center"
              onPress={handleDuplicate}
            >
              <Text className="text-white text-sm font-semibold">
                Duplicate
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="py-2 px-4 rounded-md bg-neutral-100 dark:bg-zinc-900 items-center justify-center border border-neutral-200 dark:border-zinc-800"
              onPress={() => setShowDupDialog(null)}
            >
              <Text className="text-neutral-500 text-sm">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Clone from GitHub dialog */}
      {showCloneDialog && (
        <View className="mx-5 mt-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4 relative z-50">
          <Text className="text-neutral-900 dark:text-white text-sm font-semibold mb-2">
            Clone from GitHub
          </Text>
          <TextInput
            className="bg-neutral-50 dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
            value={cloneUrl}
            onChangeText={setCloneUrl}
            placeholder="https://github.com/user/repo.git"
            placeholderTextColor="#8b949e"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <TextInput
            className="bg-neutral-50 dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm mt-2"
            value={cloneName}
            onChangeText={setCloneName}
            placeholder="Local name (auto from URL)"
            placeholderTextColor="#8b949e"
            autoCapitalize="none"
          />

          {/* Quick Browse Toggle */}
          <TouchableOpacity
            className="flex-row items-center mt-3 gap-2"
            onPress={() => setCloneLazy(!cloneLazy)}
          >
            <View className={`w-4 h-4 rounded border items-center justify-center ${cloneLazy ? 'bg-[#58a6ff] border-[#58a6ff]' : 'border-neutral-300 dark:border-zinc-700'}`}>
              {cloneLazy && <Check size={12} color="#fff" />}
            </View>
            <View>
              <Text className="text-black dark:text-white text-sm font-medium">⚡ Quick Browse (Large Repos)</Text>
              <Text className="text-neutral-500 text-[10px]">Browse full repo tree instantly. Downloads only what you open.</Text>
            </View>
          </TouchableOpacity>

          {/* Quick pick from GitHub repos */}
          {ghLinked && ghRepos.length > 0 && (
            <View className="mt-3">
              <Text className="text-neutral-500 text-xs font-bold uppercase mb-1.5">Your Repos · {ghRepos.length}</Text>
              <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                {ghRepos.map((r: any) => (
                  <TouchableOpacity
                    key={r.full_name}
                    className="flex-row items-center py-2.5 border-b border-neutral-100 dark:border-zinc-800"
                    onPress={() => {
                      setCloneUrl(r.clone_url)
                      setCloneName(r.name)
                    }}
                  >
                    <FolderGit2 size={14} color="#8b949e" />
                    <Text className="text-black dark:text-white text-sm ml-2 flex-1" numberOfLines={1}>
                      {r.full_name}
                    </Text>
                    <View className="flex-row items-center gap-1.5">
                      {r.permissions && !r.permissions.admin && (
                        <Text className="text-[10px] text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded font-medium">
                          collab
                        </Text>
                      )}
                      {r.private && (
                        <Text className="text-[10px] text-neutral-500 bg-neutral-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-medium">
                          private
                        </Text>
                      )}
                      {r.fork && (
                        <Text className="text-[10px] text-purple-500 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded font-medium">
                          fork
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          {loadingGhRepos && (
            <ActivityIndicator size="small" color="#58a6ff" style={{ marginTop: 8 }} />
          )}

          <View className="flex-row gap-2 mt-3">
            <TouchableOpacity
              className="flex-1 py-2.5 rounded-md bg-[#2ea043] items-center flex-row justify-center gap-2"
              onPress={handleClone}
              disabled={cloning}
            >
              {cloning ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Github size={14} color="#fff" />
                  <Text className="text-white text-sm font-semibold">Clone</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              className="py-2.5 px-4 rounded-md bg-neutral-100 dark:bg-zinc-900 items-center justify-center border border-neutral-200 dark:border-zinc-800"
              onPress={() => setShowCloneDialog(false)}
            >
              <Text className="text-neutral-500 text-sm">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text className="px-5 pt-3 text-neutral-500 text-xs uppercase tracking-wider">
        Repositories · {repoCountLabel}
      </Text>

      <ScrollView
        className="flex-1 px-5 pt-2"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refreshRepos}
            tintColor="#58a6ff"
          />
        }
      >
        {loading && repos.length === 0 ? (
          <View className="mt-3 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 ">
            <Text className="text-neutral-500">Loading repositories…</Text>
          </View>
        ) : repos.length === 0 ? (
          <View className="mt-3 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 ">
            <Text className="text-black dark:text-neutral-100 text-base font-semibold">
              No repositories yet
            </Text>
            <Text className="text-neutral-500 mt-1">
              Use + Init or Import to get started.
            </Text>
          </View>
        ) : (
          repos.map((repo) => (
            <TouchableOpacity
              key={repo.name}
              className="mt-3 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 active:bg-neutral-50 active:dark:bg-zinc-800 "
              onPress={() =>
                router.push({
                  pathname: '/repo/[name]',
                  params: { name: repo.name },
                } as any)
              }
              onLongPress={() => showRepoActions(repo.name)}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-black items-center justify-center">
                    {repo.isGitRepo ? (
                      <FolderGit2 size={24} color="#58a6ff" />
                    ) : (
                      <FolderClosed size={24} color="#8b949e" />
                    )}
                  </View>
                  <Text className="text-black dark:text-white text-2xl font-bold">
                    {repo.name}
                  </Text>
                </View>
                <ChevronRight size={24} color="#8b949e" />
              </View>

              <Text className="text-neutral-500 text-sm mt-3 font-semibold">
                Branch: <Text className="text-black dark:text-neutral-100 font-bold">{repo.branch}</Text>
              </Text>

              <View className="flex-row items-center mt-2 border-t border-neutral-100 dark:border-zinc-800 pt-3">
                <Text
                  style={{ color: repo.statusColor }}
                  className="text-sm font-semibold mr-2"
                >
                  ● {repo.statusText}
                </Text>
                <Text className="text-neutral-400 text-sm">
                  · {repo.sizeText} · {repo.ageText}
                </Text>
              </View>

              {/* Sync status row */}
              {repo.hasRemote && (
                <View className="flex-row items-center mt-2 gap-2">
                  {repo.pendingPushes > 0 && (
                    <View className="flex-row items-center bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
                      <CloudUpload size={12} color="#d29922" />
                      <Text className="text-amber-700 dark:text-amber-400 text-xs font-semibold ml-1">
                        {repo.pendingPushes} pending
                      </Text>
                    </View>
                  )}
                  {repo.ahead > 0 && (
                    <Text className="text-xs text-blue-500 font-semibold">↑{repo.ahead}</Text>
                  )}
                  {repo.behind > 0 && (
                    <Text className="text-xs text-orange-500 font-semibold">↓{repo.behind}</Text>
                  )}
                  {repo.lastSync && (
                    <Text className="text-neutral-400 text-xs">
                      synced {repo.ageText}
                    </Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  )
}
