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

  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#30363d]">
        <Text className="text-[#e6edf3] text-lg font-bold">History</Text>
        <Text className="text-[#8b949e] text-xs">{commits.length} commits</Text>
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
                    </View>
                  </TouchableOpacity>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
