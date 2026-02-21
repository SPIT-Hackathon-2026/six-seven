import { useCallback, useState } from 'react'
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
} from '@/services/gitService'
import { stash, stashList, stashPop } from '@/services/stashService'
import { deleteRepo, getRepoSize } from '@/services/repoService'

type RepoState = {
  branch: string
  branches: string[]
  tags: string[]
  files: { filepath: string; status: string }[]
  commits: { oid: string; message: string; author: string; timestamp: number }[]
  modifiedCount: number
  loading: boolean
  size: string
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[idx]}`
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts * 1000
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function RepoDetailScreen() {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name: string }>()
  const [repo, setRepo] = useState<RepoState>({
    branch: 'main',
    branches: [],
    tags: [],
    files: [],
    commits: [],
    modifiedCount: 0,
    loading: true,
    size: '...',
  })
  const [showBranchPicker, setShowBranchPicker] = useState(false)
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [showMerge, setShowMerge] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'branches' | 'tags'>(
    'overview',
  )

  const loadRepoData = useCallback(async () => {
    if (!name) return
    setRepo((prev) => ({ ...prev, loading: true }))
    try {
      const [branch, branches, status, log, tags, size] = await Promise.all([
        currentBranch(name).catch(() => 'main'),
        listBranches(name).catch(() => []),
        getStatus(name).catch(() => []),
        getLog(name, { depth: 10 }).catch(() => []),
        listTags(name).catch(() => []),
        getRepoSize(name).catch(() => 0),
      ])

      const modified = status.filter((s: any) => s.status !== 'unmodified')

      setRepo({
        branch: branch ?? 'main',
        branches,
        tags,
        modifiedCount: modified.length,
        files: modified,
        commits: log.map((e: any) => ({
          oid: e.oid,
          message: e.commit?.message ?? '',
          author: e.commit?.author?.name ?? 'Unknown',
          timestamp: e.commit?.author?.timestamp ?? 0,
        })),
        loading: false,
        size: formatBytes(size),
      })
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to load repo data')
      setRepo((prev) => ({ ...prev, loading: false }))
    }
  }, [name])

  useFocusEffect(
    useCallback(() => {
      loadRepoData()
    }, [loadRepoData]),
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
      Alert.alert('Commit failed', err?.message ?? 'Could not commit')
    } finally {
      setCommitting(false)
    }
  }, [name, commitMsg, loadRepoData])

  const handleCheckout = useCallback(
    async (branch: string) => {
      if (!name) return
      try {
        await checkout(name, branch)
        setShowBranchPicker(false)
        await loadRepoData()
      } catch (err: any) {
        Alert.alert('Checkout failed', err?.message ?? '')
      }
    },
    [name, loadRepoData],
  )

  const handleCreateBranch = useCallback(async () => {
    if (!name || !newBranchName.trim()) return
    try {
      await createBranch(name, newBranchName.trim(), { checkout: true })
      setNewBranchName('')
      setShowNewBranch(false)
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Branch create failed')
    }
  }, [name, newBranchName, loadRepoData])

  const handleDeleteBranch = useCallback(
    (branch: string) => {
      if (branch === repo.branch) {
        Alert.alert('Error', 'Cannot delete the current branch')
        return
      }
      Alert.alert('Delete Branch', `Delete "${branch}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBranch(name!, branch)
              await loadRepoData()
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? '')
            }
          },
        },
      ])
    },
    [name, repo.branch, loadRepoData],
  )

  const handleMerge = useCallback(
    (branch: string) => {
      if (!name) return
      Alert.alert('Merge', `Merge "${branch}" into "${repo.branch}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          onPress: async () => {
            try {
              const result = await mergeBranch(name, branch)
              Alert.alert(
                'Merged',
                result?.oid
                  ? `New commit: ${result.oid.slice(0, 7)}`
                  : 'Already up to date',
              )
              await loadRepoData()
            } catch (err: any) {
              Alert.alert('Merge failed', err?.message ?? '')
            }
          },
        },
      ])
    },
    [name, repo.branch, loadRepoData],
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
      await stash(name, `WIP on ${repo.branch}`)
      Alert.alert('Stashed', 'Changes saved to stash')
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Stash failed', err?.message ?? '')
    }
  }, [name, repo.branch, loadRepoData])

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
              Alert.alert('Error', err?.message ?? 'Delete failed')
            }
          },
        },
      ],
    )
  }, [name, router])

  if (!name) {
    return (
      <View className="flex-1 bg-[#0d1117] items-center justify-center">
        <Text className="text-[#e6edf3]">Invalid repository</Text>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#30363d]">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-[#58a6ff] text-2xl">‹</Text>
        </TouchableOpacity>
        <View className="flex-1 items-center">
          <Text className="text-[#e6edf3] text-lg font-bold">{name}</Text>
          <Text className="text-[#8b949e] text-xs">{repo.size}</Text>
        </View>
        <TouchableOpacity onPress={handleDeleteRepo}>
          <Text className="text-[#f85149] text-sm">🗑</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View className="flex-row border-b border-[#30363d]">
        {(['overview', 'branches', 'tags'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            className="flex-1 py-2.5 items-center"
            onPress={() => setActiveTab(tab)}
          >
            <Text
              className={
                activeTab === tab
                  ? 'text-[#e6edf3] text-sm font-semibold'
                  : 'text-[#8b949e] text-sm'
              }
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
            {activeTab === tab && (
              <View className="mt-1 h-0.5 w-12 rounded-full bg-[#58a6ff]" />
            )}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl
            refreshing={repo.loading}
            onRefresh={loadRepoData}
            tintColor="#58a6ff"
          />
        }
      >
        {repo.loading ? (
          <View className="mt-8 items-center">
            <ActivityIndicator color="#58a6ff" />
          </View>
        ) : activeTab === 'overview' ? (
          <>
            {/* Branch selector */}
            <TouchableOpacity
              className="mt-4 flex-row items-center gap-2 px-3 py-2 rounded-lg bg-[#161b22] border border-[#30363d]"
              onPress={() => setShowBranchPicker(!showBranchPicker)}
            >
              <Text className="text-[#e6edf3] text-sm">⎇</Text>
              <Text className="text-[#f0a65e] text-sm font-bold">
                {repo.branch}
              </Text>
              <Text className="text-[#8b949e] text-xs">▼</Text>
            </TouchableOpacity>

            {showBranchPicker && (
              <View className="rounded-lg bg-[#161b22] border border-[#30363d] mt-1">
                {repo.branches.map((b) => (
                  <TouchableOpacity
                    key={b}
                    className="px-3 py-2.5 border-b border-[#21262d] flex-row items-center justify-between"
                    onPress={() => handleCheckout(b)}
                  >
                    <Text
                      className={
                        b === repo.branch
                          ? 'text-[#58a6ff] font-semibold'
                          : 'text-[#c9d1d9]'
                      }
                    >
                      {b}
                    </Text>
                    {b === repo.branch && (
                      <Text className="text-[#58a6ff] text-xs">✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Quick actions */}
            <View className="flex-row gap-2 mt-4">
              <TouchableOpacity
                className="flex-1 py-2.5 rounded-lg bg-[#1f6feb] items-center"
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
                className="py-2.5 px-4 rounded-lg bg-[#21262d] items-center"
                onPress={handleStash}
              >
                <Text className="text-[#c9d1d9] text-sm font-semibold">
                  Stash
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="py-2.5 px-4 rounded-lg bg-[#21262d] items-center"
                onPress={handleStashPop}
              >
                <Text className="text-[#c9d1d9] text-sm font-semibold">
                  Pop
                </Text>
              </TouchableOpacity>
            </View>

            {/* Commit message */}
            <TextInput
              className="mt-3 bg-[#161b22] text-[#e6edf3] px-3 py-2 rounded-lg border border-[#30363d] text-sm"
              placeholder="Commit message (optional, auto-generated if empty)"
              placeholderTextColor="#484f58"
              value={commitMsg}
              onChangeText={setCommitMsg}
            />

            {/* Status summary */}
            <View className="mt-4 rounded-lg bg-[#161b22] border border-[#30363d] p-3">
              <Text className="text-[#e6edf3] text-sm font-semibold">
                {repo.modifiedCount === 0
                  ? '✓ Working tree clean'
                  : `${repo.modifiedCount} changed file${repo.modifiedCount !== 1 ? 's' : ''}`}
              </Text>
              {repo.files.length > 0 && (
                <View className="mt-2">
                  {repo.files.slice(0, 8).map((f) => (
                    <View
                      key={f.filepath}
                      className="flex-row items-center py-1"
                    >
                      <Text
                        className="text-xs font-bold w-4"
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
                        className="text-[#c9d1d9] text-xs flex-1 ml-1"
                        numberOfLines={1}
                      >
                        {f.filepath}
                      </Text>
                    </View>
                  ))}
                  {repo.files.length > 8 && (
                    <Text className="text-[#484f58] text-xs mt-1">
                      +{repo.files.length - 8} more
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* Recent Commits */}
            <View className="mt-4">
              <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-2">
                Recent Commits
              </Text>
              {repo.commits.length === 0 ? (
                <Text className="text-[#484f58] text-sm">No commits yet</Text>
              ) : (
                repo.commits.slice(0, 5).map((c) => (
                  <View
                    key={c.oid}
                    className="flex-row items-start py-2 border-b border-[#21262d]"
                  >
                    <View className="w-2 h-2 rounded-full bg-[#30363d] mt-1.5 mr-2" />
                    <View className="flex-1">
                      <Text
                        className="text-[#e6edf3] text-sm"
                        numberOfLines={1}
                      >
                        {c.message.trim()}
                      </Text>
                      <Text className="text-[#484f58] text-xs mt-0.5">
                        {c.author} · {timeAgo(c.timestamp)} ·{' '}
                        {c.oid.slice(0, 7)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View className="mt-4 mb-4">
              <Text className="text-[#8b949e] text-xs">
                {repo.branches.length} branch
                {repo.branches.length !== 1 ? 'es' : ''} · {repo.tags.length}{' '}
                tag{repo.tags.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </>
        ) : activeTab === 'branches' ? (
          <>
            {/* New branch */}
            <TouchableOpacity
              className="mt-4 py-2.5 rounded-lg bg-[#1f6feb] items-center"
              onPress={() => setShowNewBranch(!showNewBranch)}
            >
              <Text className="text-white text-sm font-semibold">
                + New Branch
              </Text>
            </TouchableOpacity>

            {showNewBranch && (
              <View className="mt-2 rounded-lg bg-[#161b22] border border-[#30363d] p-3 flex-row gap-2">
                <TextInput
                  className="flex-1 bg-[#0d1117] text-[#e6edf3] px-3 py-1.5 rounded-md border border-[#30363d] text-sm"
                  value={newBranchName}
                  onChangeText={setNewBranchName}
                  placeholder="branch-name"
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
            )}

            {/* Branch list */}
            <View className="mt-3">
              {repo.branches.map((b) => (
                <View
                  key={b}
                  className="flex-row items-center justify-between py-3 border-b border-[#21262d]"
                >
                  <TouchableOpacity
                    className="flex-1"
                    onPress={() => handleCheckout(b)}
                  >
                    <View className="flex-row items-center gap-2">
                      <Text className="text-[#c9d1d9] text-sm">⎇</Text>
                      <Text
                        className={
                          b === repo.branch
                            ? 'text-[#58a6ff] font-semibold text-sm'
                            : 'text-[#c9d1d9] text-sm'
                        }
                      >
                        {b}
                      </Text>
                      {b === repo.branch && (
                        <View className="px-1.5 py-0.5 rounded-full bg-[#1f6feb33]">
                          <Text className="text-[#58a6ff] text-[10px]">
                            current
                          </Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                  <View className="flex-row gap-2">
                    {b !== repo.branch && (
                      <>
                        <TouchableOpacity onPress={() => handleMerge(b)}>
                          <Text className="text-[#8b949e] text-xs">Merge</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDeleteBranch(b)}>
                          <Text className="text-[#f85149] text-xs">Delete</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : (
          /* Tags tab */
          <>
            <TouchableOpacity
              className="mt-4 py-2.5 rounded-lg bg-[#1f6feb] items-center"
              onPress={() => setShowTagInput(!showTagInput)}
            >
              <Text className="text-white text-sm font-semibold">
                + New Tag
              </Text>
            </TouchableOpacity>

            {showTagInput && (
              <View className="mt-2 rounded-lg bg-[#161b22] border border-[#30363d] p-3 flex-row gap-2">
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
            )}

            <View className="mt-3">
              {repo.tags.length === 0 ? (
                <Text className="text-[#484f58] text-sm mt-2">No tags yet</Text>
              ) : (
                repo.tags.map((t) => (
                  <View
                    key={t}
                    className="flex-row items-center justify-between py-3 border-b border-[#21262d]"
                  >
                    <View className="flex-row items-center gap-2">
                      <Text className="text-[#c9d1d9] text-sm">🏷</Text>
                      <Text className="text-[#c9d1d9] text-sm">{t}</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleDeleteTag(t)}>
                      <Text className="text-[#f85149] text-xs">Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}
