import { useCallback, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useFocusEffect } from 'expo-router'

import { listRepos } from '@/services/repoService'
import {
  getLog,
  currentBranch,
  listBranches,
  diffSummary,
  getReflog,
  resetHard,
} from '@/services/gitService'

type CommitEntry = {
  oid: string
  message: string
  author: string
  email: string
  timestamp: number
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts * 1000
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

export default function HistoryScreen() {
  const [repos, setRepos] = useState<string[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [branch, setBranch] = useState('main')
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [showRepoPicker, setShowRepoPicker] = useState(false)
  const [expandedOid, setExpandedOid] = useState<string | null>(null)
  const [commitDetail, setCommitDetail] = useState<any>(null)
  const [viewMode, setViewMode] = useState<'commits' | 'reflog'>('commits')
  const [reflogEntries, setReflogEntries] = useState<any[]>([])
  const [loadingReflog, setLoadingReflog] = useState(false)

  useFocusEffect(
    useCallback(() => {
      ;(async () => {
        const list = await listRepos()
        const names = list.filter((r) => r.isGitRepo).map((r) => r.name)
        setRepos(names)
        if (names.length > 0 && !selectedRepo) setSelectedRepo(names[0])
      })()
    }, []),
  )

  const refreshLog = useCallback(async () => {
    if (!selectedRepo) return
    setLoading(true)
    try {
      const [br, log] = await Promise.all([
        currentBranch(selectedRepo).catch(() => 'main'),
        getLog(selectedRepo, { depth: 50 }).catch(() => []),
      ])
      setBranch(br ?? 'main')
      setCommits(
        log.map((entry: any) => ({
          oid: entry.oid,
          message: entry.commit?.message ?? entry.message ?? '',
          author: entry.commit?.author?.name ?? entry.author ?? 'Unknown',
          email: entry.commit?.author?.email ?? '',
          timestamp: entry.commit?.author?.timestamp ?? entry.timestamp ?? 0,
        })),
      )
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to load log')
    } finally {
      setLoading(false)
    }
  }, [selectedRepo])

  useFocusEffect(
    useCallback(() => {
      if (selectedRepo) refreshLog()
    }, [selectedRepo, refreshLog]),
  )

  const handleExpand = useCallback(
    async (oid: string) => {
      if (expandedOid === oid) {
        setExpandedOid(null)
        setCommitDetail(null)
        return
      }
      setExpandedOid(oid)
      if (!selectedRepo) return
      try {
        const diff = await diffSummary(selectedRepo, oid)
        setCommitDetail(diff)
      } catch {
        setCommitDetail(null)
      }
    },
    [expandedOid, selectedRepo],
  )

  const loadReflog = useCallback(async () => {
    if (!selectedRepo) return
    setLoadingReflog(true)
    try {
      const entries = await getReflog(selectedRepo)
      setReflogEntries(entries.reverse()) // newest first
    } catch {
      setReflogEntries([])
    } finally {
      setLoadingReflog(false)
    }
  }, [selectedRepo])

  const handleResetToCommit = useCallback(
    (oid: string) => {
      if (!selectedRepo) return
      Alert.alert(
        'Reset to commit',
        `This will reset the current branch to ${oid.slice(0, 7)}. Uncommitted changes will be lost.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset',
            style: 'destructive',
            onPress: async () => {
              try {
                await resetHard(selectedRepo, oid)
                Alert.alert(
                  'Reset complete',
                  `Branch reset to ${oid.slice(0, 7)}`,
                )
                refreshLog()
              } catch (err: any) {
                Alert.alert('Reset failed', err?.message ?? '')
              }
            },
          },
        ],
      )
    },
    [selectedRepo, refreshLog],
  )

  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black w-full">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-zinc-800">
        <Text className="text-black dark:text-white text-lg font-bold">History</Text>
        <View className="flex-row gap-2 items-center">
          <TouchableOpacity
            className={`px-3 py-1 rounded-md ${viewMode === 'commits' ? 'bg-[#1f6feb]' : 'bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800'}`}
            onPress={() => setViewMode('commits')}
          >
            <Text
              className={`text-xs ${viewMode === 'commits' ? 'text-white' : 'text-neutral-500'}`}
            >
              Commits
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`px-3 py-1 rounded-md ${viewMode === 'reflog' ? 'bg-[#1f6feb]' : 'bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800'}`}
            onPress={() => {
              setViewMode('reflog')
              loadReflog()
            }}
          >
            <Text
              className={`text-xs ${viewMode === 'reflog' ? 'text-white' : 'text-neutral-500'}`}
            >
              Reflog
            </Text>
          </TouchableOpacity>
          <Text className="text-neutral-500 text-xs">
            {viewMode === 'commits'
              ? `${commits.length} commits`
              : `${reflogEntries.length} entries`}
          </Text>
        </View>
      </View>

      {/* Repo picker */}
      <TouchableOpacity
        className="mx-5 mt-3 px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center justify-between "
        onPress={() => setShowRepoPicker(!showRepoPicker)}
      >
        <Text className="text-black dark:text-white font-semibold">
          {selectedRepo ?? 'Select repo'}
        </Text>
        <Text className="text-neutral-500">{showRepoPicker ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {showRepoPicker && (
        <View className="mx-5 mt-1 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 max-h-40 ">
          <ScrollView>
            {repos.map((r) => (
              <TouchableOpacity
                key={r}
                className="px-4 py-3 border-b border-neutral-100 dark:border-zinc-800"
                onPress={() => {
                  setSelectedRepo(r)
                  setShowRepoPicker(false)
                }}
              >
                <Text
                  className={
                    r === selectedRepo
                      ? 'text-[#58a6ff] font-semibold'
                      : 'text-neutral-500'
                  }
                >
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {selectedRepo && (
        <Text className="mx-5 mt-3 text-neutral-500 text-xs">
          Branch: <Text className="text-[#f0a65e] font-semibold">{branch}</Text>
        </Text>
      )}

      <ScrollView
        className="flex-1 px-5 mt-2"
        contentContainerStyle={{ paddingBottom: 160 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refreshLog}
            tintColor="#58a6ff"
          />
        }
      >
        {!selectedRepo ? (
          <View className="mt-8 items-center">
            <Text className="text-neutral-500">No Git repository selected</Text>
          </View>
        ) : viewMode === 'reflog' ? (
          /* ── Reflog view ── */
          loadingReflog ? (
            <View className="mt-8 items-center">
              <ActivityIndicator color="#58a6ff" />
            </View>
          ) : reflogEntries.length === 0 ? (
            <View className="mt-8 items-center">
              <Text className="text-neutral-500 text-base">
                No reflog entries
              </Text>
              <Text className="text-neutral-400 text-sm mt-1">
                Reflog tracks branch changes, commits & resets
              </Text>
            </View>
          ) : (
            <View className="mt-1">
              {reflogEntries.map((entry, idx) => {
                const isLast = idx === reflogEntries.length - 1
                const actionColor =
                  entry.action === 'commit'
                    ? '#7ee787'
                    : entry.action === 'reset'
                      ? '#f85149'
                      : entry.action === 'checkout'
                        ? '#58a6ff'
                        : '#d29922'
                return (
                  <View key={idx} className="flex-row">
                    <View className="items-center mr-3" style={{ width: 20 }}>
                      <View
                        className="w-3 h-3 rounded-full mt-1"
                        style={{ backgroundColor: actionColor }}
                      />
                      {!isLast && <View className="flex-1 w-px bg-neutral-200 dark:bg-zinc-800" />}
                    </View>
                    <View className="flex-1 mb-3">
                      <View className="rounded-lg bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-3 ">
                        <View className="flex-row items-center gap-2 mb-1">
                          <View className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-black">
                            <Text
                              style={{ color: actionColor }}
                              className="text-[10px] font-bold uppercase"
                            >
                              {entry.action}
                            </Text>
                          </View>
                          {entry.branch && (
                            <Text className="text-[#f0a65e] text-xs font-semibold">
                              {entry.branch}
                            </Text>
                          )}
                        </View>
                        {entry.message && (
                          <Text
                            className="text-black dark:text-neutral-100 text-sm font-medium"
                            numberOfLines={2}
                          >
                            {entry.message}
                          </Text>
                        )}
                        <View className="flex-row items-center mt-1.5 gap-2">
                          {entry.from && (
                            <Text className="text-neutral-400 text-xs font-mono">
                              {entry.from.slice(0, 7)}
                            </Text>
                          )}
                          {entry.from && entry.to && (
                            <Text className="text-neutral-400 text-xs">→</Text>
                          )}
                          {entry.to && (
                            <Text className="text-neutral-500 text-xs font-mono">
                              {entry.to.slice(0, 7)}
                            </Text>
                          )}
                          <Text className="text-neutral-400 text-xs">·</Text>
                          <Text className="text-neutral-500 text-xs">
                            {new Date(entry.timestamp).toLocaleString()}
                          </Text>
                        </View>
                        {entry.to && (
                          <TouchableOpacity
                            className="mt-2 px-2.5 py-1.5 rounded bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800 self-start"
                            onPress={() => handleResetToCommit(entry.to)}
                          >
                            <Text className="text-[#f85149] font-medium text-xs">
                              Reset here
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                )
              })}
            </View>
          )
        ) : loading && commits.length === 0 ? (
          <View className="mt-8 items-center">
            <ActivityIndicator color="#58a6ff" />
          </View>
        ) : commits.length === 0 ? (
          <View className="mt-8 items-center">
            <Text className="text-neutral-500 text-base">No commits yet</Text>
            <Text className="text-neutral-400 text-sm mt-1">
              Make your first commit in Source Control
            </Text>
          </View>
        ) : (
          <View className="mt-1">
            {/* Commit graph / timeline */}
            {commits.map((c, idx) => {
              const isExpanded = expandedOid === c.oid
              const isLast = idx === commits.length - 1
              return (
                <View key={c.oid} className="flex-row">
                  {/* Timeline column */}
                  <View className="items-center mr-3" style={{ width: 20 }}>
                    <View
                      className="w-3 h-3 rounded-full mt-1"
                      style={{
                        backgroundColor: idx === 0 ? '#58a6ff' : '#8b949e',
                      }}
                    />
                    {!isLast && <View className="flex-1 w-px bg-neutral-200 dark:bg-zinc-800" />}
                  </View>

                  {/* Commit card */}
                  <TouchableOpacity
                    className="flex-1 mb-3"
                    onPress={() => handleExpand(c.oid)}
                    activeOpacity={0.7}
                  >
                    <View className="rounded-lg bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-3 ">
                      <Text
                        className="text-black dark:text-neutral-100 text-sm font-semibold"
                        numberOfLines={isExpanded ? undefined : 2}
                      >
                        {c.message.trim()}
                      </Text>
                      <View className="flex-row items-center mt-1.5 gap-2">
                        <Text className="text-neutral-500 text-xs font-medium">
                          {c.author}
                        </Text>
                        <Text className="text-neutral-400 text-xs">·</Text>
                        <Text className="text-neutral-500 text-xs">
                          {timeAgo(c.timestamp)}
                        </Text>
                        <Text className="text-neutral-400 text-xs">·</Text>
                        <Text className="text-neutral-400 text-xs font-mono">
                          {c.oid.slice(0, 7)}
                        </Text>
                      </View>

                      {isExpanded &&
                        commitDetail &&
                        Array.isArray(commitDetail) && (
                          <View className="mt-3 pt-2 border-t border-neutral-100 dark:border-zinc-800">
                            <Text className="text-neutral-500 text-xs font-bold uppercase mb-2">
                              Changed files
                            </Text>
                            {commitDetail.map((f: any) => (
                              <View
                                key={f.filepath}
                                className="flex-row items-center py-1"
                              >
                                <Text
                                  className="text-[11px] font-bold w-4 mr-1"
                                  style={{
                                    color:
                                      f.type === 'added'
                                        ? '#7ee787'
                                        : f.type === 'deleted'
                                          ? '#f85149'
                                          : '#d29922',
                                  }}
                                >
                                  {f.type === 'added'
                                    ? 'A'
                                    : f.type === 'deleted'
                                      ? 'D'
                                      : 'M'}
                                </Text>
                                <Text
                                  className="text-neutral-600 dark:text-neutral-300 text-xs flex-1 font-medium"
                                  numberOfLines={1}
                                >
                                  {f.filepath}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}

                      {isExpanded && !commitDetail && (
                        <View className="mt-3 pt-2 border-t border-neutral-100 dark:border-zinc-800">
                          <Text className="text-neutral-400 text-xs">
                            No diff details available
                          </Text>
                        </View>
                      )}

                      {isExpanded && (
                        <TouchableOpacity
                          className="mt-3 px-3 py-1.5 rounded bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800 self-start"
                          onPress={() => handleResetToCommit(c.oid)}
                        >
                          <Text className="text-[#f85149] font-semibold text-xs">
                            Reset to this commit
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </TouchableOpacity>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
