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
import {
  Package,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Check,
  RefreshCw,
  X,
  CheckSquare,
  Square,
} from 'lucide-react-native'

import { listRepos } from '@/services/repoService'
import {
  getStatus,
  stageFile,
  unstageFile,
  stageAll,
  commit,
  currentBranch,
  diffFile,
  getRemoteUrl,
  getLog,
} from '@/services/gitService'
import { generateCommitMessage } from '@/services/aiService'
import { isGitHubLinked } from '@/services/githubAuth'
import { enqueuePush } from '@/services/offlineSyncService'
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
  const [generatingMsg, setGeneratingMsg] = useState(false)
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
          staged: s.status.startsWith('*'),
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
      // Always stage all changes before committing to ensure the index is up to date
      await stageAll(selectedRepo)
      await commit(selectedRepo, commitMsg.trim())

      // Auto-enqueue push if repo has a remote
      try {
        const remoteUrl = await getRemoteUrl(selectedRepo)
        const linked = await isGitHubLinked()
        if (remoteUrl && linked) {
          const log = await getLog(selectedRepo, { depth: 1 })
          const oid = log[0]?.oid ?? 'unknown'
          await enqueuePush(selectedRepo, branch, oid, commitMsg.trim())
        }
      } catch { /* silently skip auto-push queue */ }

      setCommitMsg('')
      Alert.alert('Success', 'Changes committed')
      await refreshStatus()
    } catch (err: any) {
      Alert.alert('Commit failed', err?.message ?? 'Could not commit')
    } finally {
      setCommitting(false)
    }
  }, [selectedRepo, commitMsg, branch, refreshStatus])

  const handleGenerateCommitMsg = useCallback(async () => {
    if (!selectedRepo || files.length === 0) return
    setGeneratingMsg(true)
    try {
      const filePaths = files.map((f) => f.filepath)
      const diffText = files
        .map((f) => {
          const status = f.status.replace('*', '')
          const letter = status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M'
          return `${letter} ${f.filepath}`
        })
        .join('\n')
      const msg = await generateCommitMessage(diffText, filePaths)
      setCommitMsg(msg ?? '')
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to generate commit message')
    } finally {
      setGeneratingMsg(false)
    }
  }, [selectedRepo, files])

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
        className="flex-row items-center py-2.5 px-3 border-b border-neutral-100 dark:border-zinc-800"
      >
        <TouchableOpacity
          onPress={() => handleToggleStage(file.filepath, file.staged)}
          className="mr-3 ml-1"
        >
          <View
            className="w-5 h-5 rounded items-center justify-center border"
            style={{
              borderColor: file.staged ? '#58a6ff' : '#8b949e',
              backgroundColor: file.staged ? '#1f6feb33' : 'transparent',
            }}
          >
            {file.staged && <Check size={14} color="#58a6ff" />}
          </View>
        </TouchableOpacity>
        <Text
          style={{ color }}
          className="text-sm font-bold w-6 text-center mr-2"
        >
          {icon}
        </Text>
        <TouchableOpacity
          className="flex-1"
          onPress={() => handleViewDiff(file.filepath)}
        >
          <Text
            className="text-black dark:text-neutral-200 text-sm font-medium"
            numberOfLines={1}
          >
            {file.filepath}
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Diff overlay
  if (diffText !== null) {
    return (
      <View className="flex-1 bg-neutral-100 dark:bg-black w-full">
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-zinc-800">
          <TouchableOpacity
            className="flex-row items-center"
            onPress={() => {
              setDiffText(null)
              setDiffFile_(null)
            }}
          >
            <ChevronLeft size={20} color="#58a6ff" />
            <Text className="text-[#58a6ff] text-base font-semibold ml-1">
              Back
            </Text>
          </TouchableOpacity>
          <Text
            className="text-black dark:text-white text-sm font-bold flex-1 text-center"
            numberOfLines={1}
          >
            {diffFile_}
          </Text>
          <View className="w-16" />
        </View>
        <ScrollView className="flex-1 p-4 bg-white dark:bg-black">
          <Text
            className="text-black dark:text-neutral-300 text-xs font-mono leading-tight"
            style={{ fontFamily: 'monospace' }}
          >
            {diffText}
          </Text>
        </ScrollView>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black w-full">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-zinc-800">
        <Text className="text-black dark:text-white text-lg font-bold">
          Source Control
        </Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => {
              setShowStashList(!showStashList)
              if (!showStashList) refreshStashList()
            }}
            className="px-3 py-1.5 rounded-md bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center gap-1.5"
          >
            <Package size={14} color="#d2a8ff" />
            <Text className="text-[#d2a8ff] text-xs font-medium">Stashes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleStash}
            className="px-3 py-1.5 rounded-md bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center gap-1.5"
          >
            <ArrowDownToLine size={14} color="#8b949e" />
            <Text className="text-neutral-600 dark:text-neutral-400 text-xs font-medium">
              Stash
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleStashPop}
            className="px-3 py-1.5 rounded-md bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center gap-1.5"
          >
            <ArrowUpFromLine size={14} color="#8b949e" />
            <Text className="text-neutral-600 dark:text-neutral-400 text-xs font-medium">
              Pop
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stash management panel */}
      {showStashList && selectedRepo && (
        <View className="mx-5 mt-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
          <View className="flex-row items-center justify-between px-4 py-3 bg-neutral-100 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
            <Text className="text-black dark:text-white text-sm font-semibold">
              Stash List ({stashes.length})
            </Text>
            <View className="flex-row gap-4 items-center">
              {stashes.length > 0 && (
                <TouchableOpacity onPress={handleStashClear}>
                  <Text className="text-[#f85149] text-xs font-semibold">
                    Clear All
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setShowStashList(false)}>
                <X size={16} color="#8b949e" />
              </TouchableOpacity>
            </View>
          </View>
          {loadingStashes ? (
            <View className="py-4 items-center">
              <ActivityIndicator color="#58a6ff" size="small" />
            </View>
          ) : stashes.length === 0 ? (
            <View className="px-3 py-5 items-center">
              <Text className="text-neutral-500 text-sm">No stashes found</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 300 }}>
              {stashes.map((s) => (
                <View
                  key={s.index}
                  className="border-b border-neutral-100 dark:border-zinc-800"
                >
                  <TouchableOpacity
                    className="px-4 py-3"
                    onPress={() => handleExpandStash(s.index)}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1">
                        <Text
                          className="text-black dark:text-neutral-100 text-sm font-medium"
                          numberOfLines={1}
                        >
                          stash@{'{' + s.index + '}'}: {s.message}
                        </Text>
                        <View className="flex-row items-center gap-2 mt-1">
                          <Text className="text-neutral-500 text-xs">
                            {s.fileCount} file{s.fileCount !== 1 ? 's' : ''}
                          </Text>
                          <Text className="text-neutral-400 text-xs">·</Text>
                          <Text className="text-neutral-500 text-xs">
                            {new Date(s.timestamp).toLocaleString()}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Action buttons */}
                    <View className="flex-row gap-2 mt-3">
                      <TouchableOpacity
                        className="px-3 py-1.5 rounded-md bg-[#238636]"
                        onPress={() => handleStashApply(s.index)}
                      >
                        <Text className="text-white text-xs font-semibold">
                          Apply
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="px-3 py-1.5 rounded-md bg-[#1f6feb]"
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
                        <Text className="text-white text-xs font-semibold">
                          Pop
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="px-3 py-1.5 rounded-md bg-white dark:bg-black border border-neutral-200 dark:border-zinc-800"
                        onPress={() => handleStashDrop(s.index)}
                      >
                        <Text className="text-[#f85149] text-xs font-semibold">
                          Drop
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Expanded file list */}
                    {expandedStash === s.index && stashFiles.length > 0 && (
                      <View className="mt-3 pt-3 border-t border-neutral-100 dark:border-zinc-800">
                        {stashFiles.map((f: any) => (
                          <View
                            key={f.filepath}
                            className="flex-row items-center py-1"
                          >
                            <Text
                              className="text-[10px] font-bold w-4 mr-1"
                              style={{
                                color: f.deleted ? '#f85149' : '#7ee787',
                              }}
                            >
                              {f.deleted ? 'D' : 'M'}
                            </Text>
                            <Text
                              className="text-neutral-600 dark:text-neutral-300 text-xs flex-1"
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
        className="mx-5 mt-3 px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center justify-between "
        onPress={() => setShowRepoPicker(!showRepoPicker)}
      >
        <Text className="text-black dark:text-white font-semibold">
          {selectedRepo ?? 'Select repo'}
        </Text>
        {showRepoPicker ? (
          <ChevronUp size={16} color="#8b949e" />
        ) : (
          <ChevronDown size={16} color="#8b949e" />
        )}
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
            <Text className="text-neutral-500">No Git repository selected</Text>
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
            <Text className="text-neutral-500 text-sm mt-1">
              No uncommitted changes
            </Text>
          </View>
        ) : (
          <>
            {/* Commit box */}
            <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4 mb-5 ">
              <View className="flex-row items-start gap-2">
                <TextInput
                  className="flex-1 text-black dark:text-white text-sm min-h-[40px] bg-neutral-50 dark:bg-black rounded-lg px-3 py-2 border border-neutral-200 dark:border-zinc-800"
                  placeholder="Commit message (tap ✨ to generate)"
                  placeholderTextColor="#8b949e"
                  value={commitMsg}
                  onChangeText={setCommitMsg}
                  multiline
                />
                <TouchableOpacity
                  onPress={handleGenerateCommitMsg}
                  disabled={generatingMsg || files.length === 0}
                  className="items-center justify-center rounded-lg border px-3 py-2"
                  style={{
                    backgroundColor: generatingMsg ? '#1f2937' : '#1f6feb22',
                    borderColor: '#1f6feb88',
                    opacity: files.length === 0 ? 0.4 : 1,
                    minWidth: 44,
                    minHeight: 40,
                  }}
                >
                  {generatingMsg ? (
                    <ActivityIndicator size="small" color="#58a6ff" />
                  ) : (
                    <Text style={{ fontSize: 18 }}>✨</Text>
                  )}
                </TouchableOpacity>
              </View>
              <View className="flex-row gap-3 mt-3">
                <TouchableOpacity
                  className="flex-1 py-2.5 rounded-lg bg-[#1f6feb] items-center "
                  onPress={handleCommit}
                  disabled={committing}
                >
                  {committing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text className="text-white text-sm font-bold">Commit</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  className="py-2.5 px-5 rounded-lg bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800 items-center justify-center "
                  onPress={handleStageAll}
                >
                  <Text className="text-neutral-700 dark:text-neutral-300 text-sm font-semibold">
                    Stage All
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Staged files */}
            {staged.length > 0 && (
              <View className="mb-5">
                <Text className="text-[#7ee787] text-xs font-bold uppercase tracking-wider mb-2 ml-1">
                  Staged ({staged.length})
                </Text>
                <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                  {staged.map(renderFileRow)}
                </View>
              </View>
            )}

            {/* Unstaged files */}
            {unstaged.length > 0 && (
              <View className="mb-5">
                <Text className="text-[#d29922] text-xs font-bold uppercase tracking-wider mb-2 ml-1">
                  Changes ({unstaged.length})
                </Text>
                <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
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
