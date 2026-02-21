import { useCallback, useMemo, useState } from 'react'
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
import { useFocusEffect, useRouter } from 'expo-router'

import { listRepos } from '@/services/repoService'
import {
  getStatus,
  stageFile,
  unstageFile,
  stageAll,
  commit,
  currentBranch,
  diffFile,
} from '@/services/gitService'
import {
  stash,
  stashList,
  stashPop,
  stashApply,
  stashDrop,
  stashClear,
  stashShow,
} from '@/services/stashService'

type FileEntry = { filepath: string; status: string; staged: boolean }

function statusIcon(s: string) {
  switch (s) {
    case 'added':
      return { icon: 'A', color: '#7ee787' }
    case 'modified':
      return { icon: 'M', color: '#d29922' }
    case '*modified':
      return { icon: 'M', color: '#d29922' }
    case 'deleted':
      return { icon: 'D', color: '#f85149' }
    case '*deleted':
      return { icon: 'D', color: '#f85149' }
    case '*added':
      return { icon: 'A', color: '#7ee787' }
    case 'unmodified':
      return { icon: '✓', color: '#8b949e' }
    default:
      return { icon: '?', color: '#8b949e' }
  }
}

export default function SourceControlScreen() {
  const router = useRouter()
  const [repos, setRepos] = useState<string[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [branch, setBranch] = useState('main')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [showRepoPicker, setShowRepoPicker] = useState(false)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [diffFile_, setDiffFile_] = useState<string | null>(null)
  const [showStashList, setShowStashList] = useState(false)
  const [stashes, setStashes] = useState<any[]>([])
  const [loadingStashes, setLoadingStashes] = useState(false)
  const [expandedStash, setExpandedStash] = useState<number | null>(null)
  const [stashFiles, setStashFiles] = useState<any[]>([])

  const refreshStashList = useCallback(async () => {
    if (!selectedRepo) return
    setLoadingStashes(true)
    try {
      const list = await stashList(selectedRepo)
      setStashes(list)
    } catch {
      setStashes([])
    } finally {
      setLoadingStashes(false)
    }
  }, [selectedRepo])

  // Load repo list on focus
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

  // Refresh status when selected repo changes
  const refreshStatus = useCallback(async () => {
    if (!selectedRepo) return
    setLoading(true)
    try {
      const [br, statuses] = await Promise.all([
        currentBranch(selectedRepo).catch(() => 'main'),
        getStatus(selectedRepo).catch(() => []),
      ])
      setBranch(br ?? 'main')

      const entries: FileEntry[] = statuses
        .filter((s: any) => s.status !== 'unmodified')
        .map((s: any) => ({
          filepath: s.filepath,
          status: s.status,
          staged:
            s.status === 'added' ||
            s.status === 'modified' ||
            s.status === 'deleted',
        }))
      setFiles(entries)
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to load status')
    } finally {
      setLoading(false)
    }
  }, [selectedRepo])

  useFocusEffect(
    useCallback(() => {
      if (selectedRepo) refreshStatus()
    }, [selectedRepo, refreshStatus]),
  )

  const staged = useMemo(() => files.filter((f) => f.staged), [files])
  const unstaged = useMemo(() => files.filter((f) => !f.staged), [files])

  const handleToggleStage = useCallback(
    async (filepath: string, isStaged: boolean) => {
      if (!selectedRepo) return
      try {
        if (isStaged) {
          await unstageFile(selectedRepo, filepath)
        } else {
          await stageFile(selectedRepo, filepath)
        }
        setFiles((prev) =>
          prev.map((f) =>
            f.filepath === filepath ? { ...f, staged: !f.staged } : f,
          ),
        )
      } catch (err: any) {
        Alert.alert('Error', err?.message ?? 'Stage/unstage failed')
      }
    },
    [selectedRepo],
  )

  const handleStageAll = useCallback(async () => {
    if (!selectedRepo) return
    try {
      await stageAll(selectedRepo)
      setFiles((prev) => prev.map((f) => ({ ...f, staged: true })))
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Stage all failed')
    }
  }, [selectedRepo])

  const handleCommit = useCallback(async () => {
    if (!selectedRepo) return
    if (!commitMsg.trim()) {
      Alert.alert('Error', 'Please enter a commit message')
      return
    }
    setCommitting(true)
    try {
      if (staged.length === 0) await stageAll(selectedRepo)
      await commit(selectedRepo, commitMsg.trim())
      setCommitMsg('')
      Alert.alert('Success', 'Changes committed')
      await refreshStatus()
    } catch (err: any) {
      Alert.alert('Commit failed', err?.message ?? 'Could not commit')
    } finally {
      setCommitting(false)
    }
  }, [selectedRepo, commitMsg, staged.length, refreshStatus])

  const handleStash = useCallback(async () => {
    if (!selectedRepo) return
    try {
      await stash(selectedRepo, `WIP on ${branch}`)
      Alert.alert('Stashed', 'Working changes saved to stash')
      await refreshStatus()
    } catch (err: any) {
      Alert.alert('Stash failed', err?.message ?? '')
    }
  }, [selectedRepo, branch, refreshStatus])

  const handleStashPop = useCallback(async () => {
    if (!selectedRepo) return
    try {
      await stashPop(selectedRepo)
      Alert.alert('Stash applied', 'Last stash restored and removed')
      await refreshStatus()
      refreshStashList()
    } catch (err: any) {
      Alert.alert('Stash pop failed', err?.message ?? '')
    }
  }, [selectedRepo, refreshStatus, refreshStashList])

  const handleStashApply = useCallback(
    async (index: number) => {
      if (!selectedRepo) return
      try {
        await stashApply(selectedRepo, index)
        Alert.alert('Applied', `Stash @{${index}} applied (kept in list)`)
        await refreshStatus()
      } catch (err: any) {
        Alert.alert('Apply failed', err?.message ?? '')
      }
    },
    [selectedRepo, refreshStatus],
  )

  const handleStashDrop = useCallback(
    async (index: number) => {
      if (!selectedRepo) return
      Alert.alert('Drop stash', `Drop stash @{${index}}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Drop',
          style: 'destructive',
          onPress: async () => {
            try {
              await stashDrop(selectedRepo, index)
              refreshStashList()
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? '')
            }
          },
        },
      ])
    },
    [selectedRepo, refreshStashList],
  )

  const handleStashClear = useCallback(() => {
    if (!selectedRepo) return
    Alert.alert('Clear all stashes', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try {
            await stashClear(selectedRepo)
            setStashes([])
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? '')
          }
        },
      },
    ])
  }, [selectedRepo])

  const handleExpandStash = useCallback(
    async (index: number) => {
      if (expandedStash === index) {
        setExpandedStash(null)
        setStashFiles([])
        return
      }
      setExpandedStash(index)
      if (!selectedRepo) return
      try {
        const files = await stashShow(selectedRepo, index)
        setStashFiles(files)
      } catch {
        setStashFiles([])
      }
    },
    [expandedStash, selectedRepo],
  )

  const handleViewDiff = useCallback(
    async (filepath: string) => {
      if (!selectedRepo) return
      try {
        const result = await diffFile(selectedRepo, filepath)
        setDiffFile_(filepath)
        setDiffText(
          result
            ? `--- a/${filepath}\n+++ b/${filepath}\n\n${
                typeof result === 'string'
                  ? result
                  : result.oldContent !== result.newContent
                    ? `Old:\n${result.oldContent ?? '(empty)'}\n\nNew:\n${result.newContent ?? '(empty)'}`
                    : '(no changes)'
              }`
            : '(new file)',
        )
      } catch {
        setDiffText('Could not generate diff')
        setDiffFile_(filepath)
      }
    },
    [selectedRepo],
  )

  const renderFileRow = (file: FileEntry) => {
    const { icon, color } = statusIcon(file.status)
    return (
      <View
        key={file.filepath}
        className="flex-row items-center py-2 px-2 border-b border-[#21262d]"
      >
        <TouchableOpacity
          onPress={() => handleToggleStage(file.filepath, file.staged)}
          className="mr-2"
        >
          <View
            className="w-5 h-5 rounded border items-center justify-center"
            style={{
              borderColor: file.staged ? '#58a6ff' : '#30363d',
              backgroundColor: file.staged ? '#1f6feb33' : 'transparent',
            }}
          >
            {file.staged && <Text className="text-[#58a6ff] text-xs">✓</Text>}
          </View>
        </TouchableOpacity>
        <Text
          style={{ color }}
          className="text-sm font-bold w-5 text-center mr-2"
        >
          {icon}
        </Text>
        <TouchableOpacity
          className="flex-1"
          onPress={() => handleViewDiff(file.filepath)}
        >
          <Text className="text-[#c9d1d9] text-sm" numberOfLines={1}>
            {file.filepath}
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Diff overlay
  if (diffText !== null) {
    return (
      <View className="flex-1 bg-[#0d1117]">
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#30363d]">
          <TouchableOpacity
            onPress={() => {
              setDiffText(null)
              setDiffFile_(null)
            }}
          >
            <Text className="text-[#58a6ff] text-base font-semibold">
              ‹ Back
            </Text>
          </TouchableOpacity>
          <Text
            className="text-[#e6edf3] text-sm font-bold flex-1 text-center"
            numberOfLines={1}
          >
            {diffFile_}
          </Text>
          <View className="w-10" />
        </View>
        <ScrollView className="flex-1 p-4">
          <Text
            className="text-[#c9d1d9] text-xs font-mono"
            style={{ fontFamily: 'monospace' }}
          >
            {diffText}
          </Text>
        </ScrollView>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#30363d]">
        <Text className="text-[#e6edf3] text-lg font-bold">Source Control</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => {
              setShowStashList(!showStashList)
              if (!showStashList) refreshStashList()
            }}
            className="px-3 py-1 rounded-md bg-[#21262d]"
          >
            <Text className="text-[#d2a8ff] text-xs">📦 Stashes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleStash}
            className="px-3 py-1 rounded-md bg-[#21262d]"
          >
            <Text className="text-[#c9d1d9] text-xs">Stash</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleStashPop}
            className="px-3 py-1 rounded-md bg-[#21262d]"
          >
            <Text className="text-[#c9d1d9] text-xs">Pop</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stash management panel */}
      {showStashList && selectedRepo && (
        <View className="mx-5 mt-2 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
          <View className="flex-row items-center justify-between px-3 py-2 bg-[#21262d] border-b border-[#30363d]">
            <Text className="text-[#e6edf3] text-sm font-semibold">
              Stash List ({stashes.length})
            </Text>
            <View className="flex-row gap-2">
              {stashes.length > 0 && (
                <TouchableOpacity onPress={handleStashClear}>
                  <Text className="text-[#f85149] text-xs">Clear All</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setShowStashList(false)}>
                <Text className="text-[#8b949e] text-sm">✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          {loadingStashes ? (
            <View className="py-4 items-center">
              <ActivityIndicator color="#58a6ff" size="small" />
            </View>
          ) : stashes.length === 0 ? (
            <View className="px-3 py-4 items-center">
              <Text className="text-[#484f58] text-sm">No stashes</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 300 }}>
              {stashes.map((s) => (
                <View key={s.index} className="border-b border-[#21262d]">
                  <TouchableOpacity
                    className="px-3 py-2.5"
                    onPress={() => handleExpandStash(s.index)}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1">
                        <Text
                          className="text-[#e6edf3] text-sm"
                          numberOfLines={1}
                        >
                          stash@{'{' + s.index + '}'}: {s.message}
                        </Text>
                        <View className="flex-row items-center gap-2 mt-0.5">
                          <Text className="text-[#8b949e] text-xs">
                            {s.fileCount} file{s.fileCount !== 1 ? 's' : ''}
                          </Text>
                          <Text className="text-[#484f58] text-xs">·</Text>
                          <Text className="text-[#8b949e] text-xs">
                            {new Date(s.timestamp).toLocaleString()}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Action buttons */}
                    <View className="flex-row gap-2 mt-2">
                      <TouchableOpacity
                        className="px-2.5 py-1 rounded bg-[#238636]"
                        onPress={() => handleStashApply(s.index)}
                      >
                        <Text className="text-white text-xs">Apply</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="px-2.5 py-1 rounded bg-[#1f6feb]"
                        onPress={async () => {
                          try {
                            await stashPop(selectedRepo!, s.index)
                            Alert.alert(
                              'Popped',
                              `Stash @{${s.index}} applied & removed`,
                            )
                            refreshStashList()
                            refreshStatus()
                          } catch (err: any) {
                            Alert.alert('Error', err?.message ?? '')
                          }
                        }}
                      >
                        <Text className="text-white text-xs">Pop</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="px-2.5 py-1 rounded bg-[#21262d] border border-[#30363d]"
                        onPress={() => handleStashDrop(s.index)}
                      >
                        <Text className="text-[#f85149] text-xs">Drop</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Expanded file list */}
                    {expandedStash === s.index && stashFiles.length > 0 && (
                      <View className="mt-2 pt-2 border-t border-[#21262d]">
                        {stashFiles.map((f: any) => (
                          <View
                            key={f.filepath}
                            className="flex-row items-center py-0.5"
                          >
                            <Text
                              className="text-xs font-bold w-4 mr-1"
                              style={{
                                color: f.deleted ? '#f85149' : '#7ee787',
                              }}
                            >
                              {f.deleted ? 'D' : 'M'}
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
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

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
          Branch: <Text className="text-[#f0a65e] font-semibold">{branch}</Text>{' '}
          · {files.length} change{files.length !== 1 ? 's' : ''}
        </Text>
      )}

      <ScrollView
        className="flex-1 px-5 mt-2"
        contentContainerStyle={{ paddingBottom: 160 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refreshStatus}
            tintColor="#58a6ff"
          />
        }
      >
        {!selectedRepo ? (
          <View className="mt-8 items-center">
            <Text className="text-[#8b949e]">No Git repository selected</Text>
          </View>
        ) : loading && files.length === 0 ? (
          <View className="mt-8 items-center">
            <ActivityIndicator color="#58a6ff" />
          </View>
        ) : files.length === 0 ? (
          <View className="mt-8 items-center">
            <Text className="text-[#7ee787] text-base font-semibold">
              ✓ Working tree clean
            </Text>
            <Text className="text-[#8b949e] text-sm mt-1">
              No uncommitted changes
            </Text>
          </View>
        ) : (
          <>
            {/* Commit box */}
            <View className="rounded-lg bg-[#161b22] border border-[#30363d] p-3 mb-4">
              <TextInput
                className="text-[#e6edf3] text-sm min-h-[36px]"
                placeholder="Commit message…"
                placeholderTextColor="#484f58"
                value={commitMsg}
                onChangeText={setCommitMsg}
                multiline
              />
              <View className="flex-row gap-2 mt-2">
                <TouchableOpacity
                  className="flex-1 py-2 rounded-md bg-[#1f6feb] items-center"
                  onPress={handleCommit}
                  disabled={committing}
                >
                  {committing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text className="text-white text-sm font-semibold">
                      Commit
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  className="py-2 px-4 rounded-md bg-[#21262d] items-center"
                  onPress={handleStageAll}
                >
                  <Text className="text-[#c9d1d9] text-sm">Stage All</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Staged files */}
            {staged.length > 0 && (
              <View className="mb-4">
                <Text className="text-[#7ee787] text-xs font-bold uppercase tracking-wider mb-1">
                  Staged ({staged.length})
                </Text>
                <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                  {staged.map(renderFileRow)}
                </View>
              </View>
            )}

            {/* Unstaged files */}
            {unstaged.length > 0 && (
              <View>
                <Text className="text-[#d29922] text-xs font-bold uppercase tracking-wider mb-1">
                  Changes ({unstaged.length})
                </Text>
                <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                  {unstaged.map(renderFileRow)}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}
