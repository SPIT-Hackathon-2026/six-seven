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
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#30363d]">
        <Text className="text-[#e6edf3] text-lg font-bold">History</Text>
        <View className="flex-row gap-2 items-center">
          <TouchableOpacity
            className={`px-3 py-1 rounded-md ${viewMode === 'commits' ? 'bg-[#1f6feb]' : 'bg-[#21262d]'}`}
            onPress={() => setViewMode('commits')}
          >
            <Text
              className={`text-xs ${viewMode === 'commits' ? 'text-white' : 'text-[#c9d1d9]'}`}
            >
              Commits
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`px-3 py-1 rounded-md ${viewMode === 'reflog' ? 'bg-[#1f6feb]' : 'bg-[#21262d]'}`}
            onPress={() => {
              setViewMode('reflog')
              loadReflog()
            }}
          >
            <Text
              className={`text-xs ${viewMode === 'reflog' ? 'text-white' : 'text-[#c9d1d9]'}`}
            >
              Reflog
            </Text>
          </TouchableOpacity>
          <Text className="text-[#8b949e] text-xs">
            {viewMode === 'commits'
              ? `${commits.length} commits`
              : `${reflogEntries.length} entries`}
          </Text>
        </View>
      </View>

      {/* Repo picker */}
      <TouchableOpacity
        className="mx-5 mt-3 px-4 py-2.5 rounded-lg bg-[#161b22] border border-[#30363d] flex-row items-center justify-between"
        onPress={() => setShowRepoPicker(!showRepoPicker)}
      >
        <Text className="text-[#e6edf3] font-semibold">
          {selectedRepo ?? 'Select repo'}
        </Text>
        <Text className="text-[#8b949e]">{showRepoPicker ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {showRepoPicker && (
        <View className="mx-5 mt-1 rounded-lg bg-[#161b22] border border-[#30363d] max-h-40">
          <ScrollView>
            {repos.map((r) => (
              <TouchableOpacity
                key={r}
                className="px-4 py-2.5 border-b border-[#21262d]"
                onPress={() => {
                  setSelectedRepo(r)
                  setShowRepoPicker(false)
                }}
              >
                <Text
                  className={
                    r === selectedRepo
                      ? 'text-[#58a6ff] font-semibold'
                      : 'text-[#c9d1d9]'
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
        <Text className="mx-5 mt-2 text-[#8b949e] text-xs">
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
            <Text className="text-[#8b949e]">No Git repository selected</Text>
          </View>
        ) : viewMode === 'reflog' ? (
          /* ── Reflog view ── */
          loadingReflog ? (
            <View className="mt-8 items-center">
              <ActivityIndicator color="#58a6ff" />
            </View>
          ) : reflogEntries.length === 0 ? (
            <View className="mt-8 items-center">
              <Text className="text-[#8b949e] text-base">
                No reflog entries
              </Text>
              <Text className="text-[#484f58] text-sm mt-1">
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
                      {!isLast && <View className="flex-1 w-px bg-[#30363d]" />}
                    </View>
                    <View className="flex-1 mb-3">
                      <View className="rounded-lg bg-[#161b22] border border-[#30363d] p-3">
                        <View className="flex-row items-center gap-2 mb-1">
                          <View className="px-1.5 py-0.5 rounded bg-[#21262d]">
                            <Text
                              style={{ color: actionColor }}
                              className="text-[10px] font-bold uppercase"
                            >
                              {entry.action}
                            </Text>
                          </View>
                          {entry.branch && (
                            <Text className="text-[#f0a65e] text-xs">
                              {entry.branch}
                            </Text>
                          )}
                        </View>
                        {entry.message && (
                          <Text
                            className="text-[#e6edf3] text-sm"
                            numberOfLines={2}
                          >
                            {entry.message}
                          </Text>
                        )}
                        <View className="flex-row items-center mt-1.5 gap-2">
                          {entry.from && (
                            <Text className="text-[#484f58] text-xs font-mono">
                              {entry.from.slice(0, 7)}
                            </Text>
                          )}
                          {entry.from && entry.to && (
                            <Text className="text-[#484f58] text-xs">→</Text>
                          )}
                          {entry.to && (
                            <Text className="text-[#8b949e] text-xs font-mono">
                              {entry.to.slice(0, 7)}
                            </Text>
                          )}
                          <Text className="text-[#484f58] text-xs">·</Text>
                          <Text className="text-[#8b949e] text-xs">
                            {new Date(entry.timestamp).toLocaleString()}
                          </Text>
                        </View>
                        {entry.to && (
                          <TouchableOpacity
                            className="mt-2 px-2.5 py-1 rounded bg-[#21262d] border border-[#30363d] self-start"
                            onPress={() => handleResetToCommit(entry.to)}
                          >
                            <Text className="text-[#f85149] text-xs">
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
            <Text className="text-[#8b949e] text-base">No commits yet</Text>
            <Text className="text-[#484f58] text-sm mt-1">
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
                        backgroundColor: idx === 0 ? '#58a6ff' : '#30363d',
                      }}
                    />
                    {!isLast && <View className="flex-1 w-px bg-[#30363d]" />}
                  </View>

                  {/* Commit card */}
                  <TouchableOpacity
                    className="flex-1 mb-3"
                    onPress={() => handleExpand(c.oid)}
                    activeOpacity={0.7}
                  >
                    <View className="rounded-lg bg-[#161b22] border border-[#30363d] p-3">
                      <Text
                        className="text-[#e6edf3] text-sm font-semibold"
                        numberOfLines={isExpanded ? undefined : 2}
                      >
                        {c.message.trim()}
                      </Text>
                      <View className="flex-row items-center mt-1.5 gap-2">
                        <Text className="text-[#8b949e] text-xs">
                          {c.author}
                        </Text>
                        <Text className="text-[#484f58] text-xs">·</Text>
                        <Text className="text-[#8b949e] text-xs">
                          {timeAgo(c.timestamp)}
                        </Text>
                        <Text className="text-[#484f58] text-xs">·</Text>
                        <Text className="text-[#484f58] text-xs font-mono">
                          {c.oid.slice(0, 7)}
                        </Text>
                      </View>

                      {isExpanded &&
                        commitDetail &&
                        Array.isArray(commitDetail) && (
                          <View className="mt-3 pt-2 border-t border-[#21262d]">
                            <Text className="text-[#8b949e] text-xs font-bold uppercase mb-1">
                              Changed files
                            </Text>
                            {commitDetail.map((f: any) => (
                              <View
                                key={f.filepath}
                                className="flex-row items-center py-1"
                              >
                                <Text
                                  className="text-xs font-bold w-4 mr-1"
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
                                  className="text-[#c9d1d9] text-xs flex-1"
                                  numberOfLines={1}
                                >
                                  {f.filepath}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}

                      {isExpanded && !commitDetail && (
                        <View className="mt-3 pt-2 border-t border-[#21262d]">
                          <Text className="text-[#484f58] text-xs">
                            No diff details available
                          </Text>
                        </View>
                      )}

                      {isExpanded && (
                        <TouchableOpacity
                          className="mt-2 px-2.5 py-1 rounded bg-[#21262d] border border-[#30363d] self-start"
                          onPress={() => handleResetToCommit(c.oid)}
                        >
                          <Text className="text-[#f85149] text-xs">
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
