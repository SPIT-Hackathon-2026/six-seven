import { useCallback, useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import {
  getConflictVersions,
  resolveConflict,
  commit,
  stageAll,
  currentBranch,
  resolveRef,
} from '@/services/gitService'
import { aiSuggestMerge, isAIAvailable } from '@/services/aiService'
import { enqueuePush } from '@/services/offlineSyncService'

/* ─────────── types ─────────── */
type ConflictFile = {
  filepath: string
  base: string | null
  ours: string | null
  theirs: string | null
  resolved: string | null
  strategy: 'ours' | 'theirs' | 'manual' | null
}

/* ═══════════ COMPONENT ═══════════ */
export default function ConflictResolutionScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    name: string
    theirBranch: string
    conflicts: string
  }>()
  const { name, theirBranch } = params
  const conflictPaths: string[] = params.conflicts
    ? JSON.parse(params.conflicts)
    : []

  const [files, setFiles] = useState<ConflictFile[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFile, setActiveFile] = useState<number>(0)
  const [resolving, setResolving] = useState(false)
  const [branch, setBranch] = useState('main')
  const [editContent, setEditContent] = useState('')
  const [showEditor, setShowEditor] = useState(false)

  // AI suggestion state
  const [aiSuggestion, setAiSuggestion] = useState<{ merged: string; explanation: string } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiDismissed, setAiDismissed] = useState(false)
  const [aiAvailable] = useState(isAIAvailable())

  /* ─── load conflict versions ─── */
  useEffect(() => {
    if (!name || !theirBranch || conflictPaths.length === 0) return
    ;(async () => {
      setLoading(true)
      try {
        const br = await currentBranch(name).catch(() => 'main')
        setBranch(br ?? 'main')

        const loaded: ConflictFile[] = []
        for (const fp of conflictPaths) {
          try {
            const versions = await getConflictVersions(name, fp, theirBranch)
            loaded.push({
              filepath: fp,
              base: versions.base,
              ours: versions.ours,
              theirs: versions.theirs,
              resolved: null,
              strategy: null,
            })
          } catch {
            loaded.push({
              filepath: fp,
              base: null,
              ours: null,
              theirs: null,
              resolved: null,
              strategy: null,
            })
          }
        }
        setFiles(loaded)
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, theirBranch])

  /* ─── resolve helpers ─── */
  const chooseStrategy = useCallback(
    (index: number, strategy: 'ours' | 'theirs') => {
      setFiles((prev) => {
        const next = [...prev]
        next[index] = {
          ...next[index],
          strategy,
          resolved: strategy === 'ours' ? next[index].ours : next[index].theirs,
        }
        return next
      })
    },
    [],
  )

  const applyManualEdit = useCallback(() => {
    setFiles((prev) => {
      const next = [...prev]
      next[activeFile] = {
        ...next[activeFile],
        strategy: 'manual',
        resolved: editContent,
      }
      return next
    })
    setShowEditor(false)
  }, [activeFile, editContent])

  /* ─── AI merge suggestion ─── */
  const handleAiSuggest = useCallback(async () => {
    const file = files[activeFile]
    if (!file) return
    setAiLoading(true)
    setAiDismissed(false)
    setAiSuggestion(null)
    try {
      const result = await aiSuggestMerge(
        file.filepath,
        file.ours,
        file.theirs,
        file.base
      )
      if (result?.merged) {
        setAiSuggestion(result)
      } else {
        Alert.alert('AI Unavailable', 'Could not generate a suggestion. Try manual merge.')
      }
    } catch (err: any) {
      Alert.alert('AI Error', err?.message ?? 'Failed to get suggestion')
    } finally {
      setAiLoading(false)
    }
  }, [files, activeFile])

  const applyAiSuggestion = useCallback(() => {
    if (!aiSuggestion) return
    setFiles((prev) => {
      const next = [...prev]
      next[activeFile] = {
        ...next[activeFile],
        strategy: 'manual',
        resolved: aiSuggestion.merged,
      }
      return next
    })
    setAiSuggestion(null)
  }, [activeFile, aiSuggestion])

  const allResolved = files.every((f) => f.resolved !== null)

  const handleResolveAll = useCallback(async () => {
    if (!name || !allResolved) return
    setResolving(true)
    try {
      for (const f of files) {
        if (f.resolved !== null) {
          await resolveConflict(name, f.filepath, f.resolved)
        }
      }
      await stageAll(name)

      // To make it a true merge commit, we need both parents
      const parent1 = await resolveRef(name, branch)
      const parent2 = await resolveRef(name, theirBranch)

      const msg = `Merge ${theirBranch} into ${branch} (resolved conflicts)`
      const oid = await commit(
        name,
        msg,
        { parent: [parent1, parent2] }
      )

      // Automatically queue a push now that it's merged
      await enqueuePush(name, branch, oid, msg)

      Alert.alert('Success', 'All conflicts resolved and committed', [
        { text: 'OK', onPress: () => router.back() },
      ])
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to resolve conflicts')
    } finally {
      setResolving(false)
    }
  }, [name, files, allResolved, theirBranch, branch, router])

  /* ─── guard ─── */
  if (!name || conflictPaths.length === 0) {
    return (
      <View className="flex-1 bg-neutral-100 dark:bg-black items-center justify-center">
        <Text className="text-black dark:text-neutral-100">No conflicts to resolve</Text>
        <TouchableOpacity className="mt-4" onPress={() => router.back()}>
          <Text className="text-[#58a6ff]">Go back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const current = files[activeFile]

  /* ═══════ RENDER ═══════ */
  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-14 pb-4 border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} className="p-2">
          <Text className="text-[#58a6ff] text-2xl font-bold">‹</Text>
        </TouchableOpacity>
        <View className="flex-1 items-center">
          <Text className="text-black dark:text-neutral-100 text-lg font-bold">
            Merge Conflicts
          </Text>
          <Text className="text-neutral-500 text-[11px] font-medium mt-1">
            {branch} ← {theirBranch}
          </Text>
        </View>
        <View className="w-8" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#58a6ff" size="large" />
          <Text className="text-neutral-500 mt-3 text-sm font-medium">
            Loading conflict details...
          </Text>
        </View>
      ) : showEditor && current ? (
        /* ─── Manual editor ─── */
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-4 py-3 bg-white dark:bg-zinc-900 border-b border-neutral-200 dark:border-zinc-800 ">
            <TouchableOpacity onPress={() => setShowEditor(false)}>
              <Text className="text-[#58a6ff] text-sm font-semibold">Cancel</Text>
            </TouchableOpacity>
            <Text className="text-black dark:text-neutral-100 text-sm font-bold mx-4" numberOfLines={1}>
              {current.filepath}
            </Text>
            <TouchableOpacity onPress={applyManualEdit}>
              <Text className="text-[#7ee787] text-sm font-bold tracking-wide">
                Apply
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            className="flex-1 bg-white dark:bg-black text-black dark:text-neutral-200 p-5 font-mono text-[13px] leading-relaxed"
            value={editContent}
            onChangeText={setEditContent}
            multiline
            textAlignVertical="top"
            autoFocus
          />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 140 }}
        >
          {/* Conflict file tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
          >
            <View className="flex-row px-4 py-3 gap-2">
              {files.map((f, idx) => (
                <TouchableOpacity
                  key={f.filepath}
                  className={`px-4 py-2 rounded-lg ${idx === activeFile ? 'bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-700 ' : 'bg-transparent border border-transparent'}`}
                  onPress={() => setActiveFile(idx)}
                >
                  <View className="flex-row items-center gap-2">
                    {f.resolved !== null ? (
                      <Text className="text-[#7ee787] text-sm font-bold">✓</Text>
                    ) : (
                      <View className="w-2 h-2 rounded-full bg-[#f85149]" />
                    )}
                    <Text
                      className={
                        idx === activeFile
                          ? 'text-black dark:text-white text-[13px] font-bold'
                          : 'text-neutral-500 text-[13px] font-medium'
                      }
                      numberOfLines={1}
                    >
                      {f.filepath.split('/').pop()}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Progress bar */}
          <View className="px-5 mt-5">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider">
                {files.filter((f) => f.resolved !== null).length} /{' '}
                {files.length} resolved
              </Text>
              <Text
                className={`text-xs font-bold tracking-wide uppercase ${allResolved ? 'text-[#7ee787]' : 'text-[#d29922]'}`}
              >
                {allResolved ? 'All resolved ✓' : 'Pending...'}
              </Text>
            </View>
            <View className="h-2 rounded-full bg-neutral-200 dark:bg-zinc-800 overflow-hidden">
              <View
                className="h-full rounded-full bg-[#1f6feb]"
                style={{
                  width: `${(files.filter((f) => f.resolved !== null).length / files.length) * 100}%`,
                }}
              />
            </View>
          </View>

          {current && (
            <View className="px-5 mt-5">
              {/* File path */}
              <Text className="text-black dark:text-neutral-100 text-sm font-bold mb-4">
                {current.filepath}
              </Text>

              {/* Strategy buttons */}
              <View className="flex-col gap-3 mb-5">
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    className={`flex-1 py-3.5 rounded-xl items-center border  ${
                      current.strategy === 'ours'
                        ? 'bg-blue-50 dark:bg-[#1f6feb]/20 border-[#1f6feb]'
                        : 'bg-white dark:bg-zinc-900 border-neutral-200 dark:border-zinc-800'
                    }`}
                    onPress={() => chooseStrategy(activeFile, 'ours')}
                  >
                    <Text className={`text-sm font-bold ${current.strategy === 'ours' ? 'text-[#1f6feb] dark:text-[#58a6ff]' : 'text-neutral-700 dark:text-neutral-300'}`}>
                      Accept Ours
                    </Text>
                    <Text className={`text-[10px] uppercase tracking-wide mt-1 ${current.strategy === 'ours' ? 'text-[#1f6feb]/80 dark:text-[#58a6ff]/80' : 'text-neutral-400 font-bold'}`}>{branch}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className={`flex-1 py-3.5 rounded-xl items-center border  ${
                      current.strategy === 'theirs'
                        ? 'bg-green-50 dark:bg-[#238636]/20 border-[#238636]'
                        : 'bg-white dark:bg-zinc-900 border-neutral-200 dark:border-zinc-800'
                    }`}
                    onPress={() => chooseStrategy(activeFile, 'theirs')}
                  >
                    <Text className={`text-sm font-bold ${current.strategy === 'theirs' ? 'text-[#238636] dark:text-[#7ee787]' : 'text-neutral-700 dark:text-neutral-300'}`}>
                      Accept Theirs
                    </Text>
                    <Text className={`text-[10px] uppercase tracking-wide mt-1 ${current.strategy === 'theirs' ? 'text-[#238636]/80 dark:text-[#7ee787]/80' : 'text-neutral-400 font-bold'}`}>
                      {theirBranch}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  className={`py-3.5 rounded-xl items-center border  ${
                    current.strategy === 'manual'
                      ? 'bg-yellow-50 dark:bg-[#d29922]/20 border-[#d29922]'
                      : 'bg-white dark:bg-zinc-900 border-neutral-200 dark:border-zinc-800'
                  }`}
                  onPress={() => {
                    setEditContent(current.ours ?? current.theirs ?? '')
                    setShowEditor(true)
                  }}
                >
                  <Text className={`text-sm font-bold ${current.strategy === 'manual' ? 'text-[#d29922]' : 'text-neutral-700 dark:text-neutral-300'}`}>
                    Manual Edit
                  </Text>
                </TouchableOpacity>
                {aiAvailable && (
                  <TouchableOpacity
                    className="py-3.5 rounded-xl items-center border bg-purple-50 dark:bg-[#a371f7]/10 border-[#a371f7]/40"
                    onPress={handleAiSuggest}
                    disabled={aiLoading}
                  >
                    {aiLoading ? (
                      <View className="flex-row items-center gap-2">
                        <ActivityIndicator size="small" color="#a371f7" />
                        <Text className="text-[#a371f7] text-sm font-bold">AI is thinking...</Text>
                      </View>
                    ) : (
                      <View className="flex-row items-center gap-2">
                        <Text style={{ fontSize: 14 }}>✨</Text>
                        <Text className="text-[#a371f7] text-sm font-bold">AI Smart Merge</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              {/* AI Suggestion card (dismissable) */}
              {aiSuggestion && !aiDismissed && (
                <View className="mb-4 rounded-xl border-2 border-[#a371f7] bg-white dark:bg-zinc-900 overflow-hidden">
                  <View className="px-4 py-2.5 bg-purple-50 dark:bg-[#a371f7]/15 border-b border-[#a371f7]/30 flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Text style={{ fontSize: 12 }}>✨</Text>
                      <Text className="text-[#a371f7] text-[11px] font-bold uppercase tracking-wider">AI Suggestion</Text>
                    </View>
                    <TouchableOpacity onPress={() => setAiDismissed(true)}>
                      <Text className="text-neutral-400 text-xs font-bold">✕</Text>
                    </TouchableOpacity>
                  </View>
                  {aiSuggestion.explanation && (
                    <View className="px-4 py-2.5 bg-purple-50/50 dark:bg-[#a371f7]/5 border-b border-neutral-100 dark:border-zinc-800">
                      <Text className="text-neutral-600 dark:text-neutral-300 text-xs italic">
                        {aiSuggestion.explanation}
                      </Text>
                    </View>
                  )}
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    <View className="p-3 bg-neutral-50 dark:bg-black">
                      {aiSuggestion.merged.split('\n').map((line: string, i: number) => (
                        <Text key={i} className="text-black dark:text-neutral-200 text-xs font-mono leading-relaxed">
                          {line || ' '}
                        </Text>
                      ))}
                    </View>
                  </ScrollView>
                  <View className="flex-row border-t border-neutral-200 dark:border-zinc-800">
                    <TouchableOpacity
                      className="flex-1 py-3 items-center bg-[#a371f7]/10 border-r border-neutral-200 dark:border-zinc-800"
                      onPress={applyAiSuggestion}
                    >
                      <Text className="text-[#a371f7] text-sm font-bold">✓ Use This</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="flex-1 py-3 items-center"
                      onPress={() => setAiDismissed(true)}
                    >
                      <Text className="text-neutral-500 text-sm font-medium">Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Side-by-side diff view */}
              <View className="flex-col gap-3">
                {/* Ours */}
                <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                  <View className="px-4 py-2 bg-blue-50 dark:bg-[#1f6feb]/10 border-b border-neutral-200 dark:border-zinc-800">
                    <Text className="text-[#1f6feb] dark:text-[#58a6ff] text-[11px] font-bold uppercase tracking-wider">
                      Ours ({branch})
                    </Text>
                  </View>
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    <View className="p-3 bg-neutral-50 dark:bg-black">
                      {(current.ours ?? '(empty)')
                        .split('\n')
                        .map((line, i) => (
                          <Text
                            key={i}
                            className="text-black dark:text-neutral-200 text-xs font-mono leading-relaxed"
                          >
                            {line || ' '}
                          </Text>
                        ))}
                    </View>
                  </ScrollView>
                </View>

                {/* Theirs */}
                <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                  <View className="px-4 py-2 bg-green-50 dark:bg-[#238636]/10 border-b border-neutral-200 dark:border-zinc-800">
                    <Text className="text-[#238636] dark:text-[#7ee787] text-[11px] font-bold uppercase tracking-wider">
                      Theirs ({theirBranch})
                    </Text>
                  </View>
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    <View className="p-3 bg-neutral-50 dark:bg-black">
                      {(current.theirs ?? '(empty)')
                        .split('\n')
                        .map((line, i) => (
                          <Text
                            key={i}
                            className="text-black dark:text-neutral-200 text-xs font-mono leading-relaxed"
                          >
                            {line || ' '}
                          </Text>
                        ))}
                    </View>
                  </ScrollView>
                </View>
              </View>

              {/* Unified diff view */}
              <View className="mt-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
                <View className="px-4 py-2 bg-neutral-100 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
                  <Text className="text-neutral-700 dark:text-neutral-300 text-[11px] font-bold uppercase tracking-wider">
                    📋 Unified Diff
                  </Text>
                </View>
                <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled horizontal showsHorizontalScrollIndicator={false}>
                  <View className="bg-neutral-50 dark:bg-black min-w-full">
                    {renderUnifiedDiff(current.filepath, current.ours, current.theirs)}
                  </View>
                </ScrollView>
              </View>

              {/* Base version (collapsible) */}
              {current.base && (
                <View className="mt-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                  <View className="px-4 py-2 bg-neutral-100 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
                    <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider">
                      Base (common ancestor)
                    </Text>
                  </View>
                  <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                    <View className="p-3 bg-neutral-50 dark:bg-black">
                      {current.base.split('\n').map((line, i) => (
                        <Text
                          key={i}
                          className="text-neutral-500 dark:text-neutral-400 text-xs font-mono leading-relaxed"
                        >
                          {line || ' '}
                        </Text>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* Resolution preview */}
              {current.resolved !== null && (
                <View className="mt-4 rounded-xl bg-white dark:bg-zinc-900 border-2 border-[#238636] overflow-hidden ">
                  <View className="px-4 py-2 bg-green-50 dark:bg-[#238636]/20 border-b border-[#238636]/30">
                    <Text className="text-[#238636] dark:text-[#7ee787] text-[11px] font-bold uppercase tracking-wider">
                      ✓ Resolved ({current.strategy})
                    </Text>
                  </View>
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    <View className="p-3 bg-neutral-50 dark:bg-black">
                      {current.resolved.split('\n').map((line, i) => (
                        <Text
                          key={i}
                          className="text-black dark:text-neutral-200 text-xs font-mono leading-relaxed"
                        >
                          {line || ' '}
                        </Text>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}
            </View>
          )}

          {/* Commit button */}
          <View className="px-5 mt-6 border-t border-neutral-200 dark:border-zinc-800/50 pt-6">
            <TouchableOpacity
              className={`py-4 rounded-xl items-center  ${allResolved ? 'bg-[#1f6feb]' : 'bg-neutral-200 dark:bg-zinc-800'}`}
              onPress={handleResolveAll}
              disabled={!allResolved || resolving}
            >
              {resolving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text
                  className={`text-sm font-bold tracking-wide ${allResolved ? 'text-white' : 'text-neutral-500'}`}
                >
                  {allResolved
                    ? 'Resolve All & Commit'
                    : `Resolve remaining ${files.filter((f) => f.resolved === null).length} file(s)`}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  )
}

/* ─── Unified Diff Renderer ─── */
function renderUnifiedDiff(filepath: string, ours: string | null, theirs: string | null) {
  const oursLines = (ours ?? '').split('\n')
  const theirsLines = (theirs ?? '').split('\n')
  const rows: React.ReactElement[] = []

  // Header
  rows.push(
    <View key="header-a" className="px-3 py-1 bg-blue-50 dark:bg-blue-950 border-b border-blue-100 dark:border-blue-900">
      <Text className="text-blue-700 dark:text-blue-300 text-xs font-mono">
        --- a/{filepath}
      </Text>
    </View>
  )
  rows.push(
    <View key="header-b" className="px-3 py-1 bg-green-50 dark:bg-green-950 border-b border-green-100 dark:border-green-900">
      <Text className="text-green-700 dark:text-green-300 text-xs font-mono">
        +++ b/{filepath}
      </Text>
    </View>
  )

  // Compare lines
  const maxLen = Math.max(oursLines.length, theirsLines.length)
  for (let i = 0; i < maxLen; i++) {
    const ourLine = oursLines[i]
    const theirLine = theirsLines[i]

    if (ourLine === theirLine) {
      // Unchanged line
      rows.push(
        <View key={`${i}-equal`} className="flex-row items-center px-3 py-0.5">
          <Text className="text-neutral-400 dark:text-neutral-600 text-[9px] w-6 text-right mr-2 font-mono">
            {i + 1}
          </Text>
          <Text className="text-neutral-600 dark:text-neutral-400 text-xs font-mono flex-1">
            {' '}
            {ourLine || ''}
          </Text>
        </View>
      )
    } else {
      // Our version (removed)
      if (ourLine !== undefined) {
        rows.push(
          <View key={`${i}-our`} className="flex-row items-center px-3 py-0.5 bg-red-50 dark:bg-red-950/30">
            <Text className="text-red-500 dark:text-red-400 text-[9px] w-6 text-right mr-2 font-mono opacity-80">
              {i + 1}
            </Text>
            <Text className="text-red-700 dark:text-red-300 text-xs font-mono flex-1">
              -{ourLine}
            </Text>
          </View>
        )
      }

      // Their version (added)
      if (theirLine !== undefined) {
        rows.push(
          <View key={`${i}-their`} className="flex-row items-center px-3 py-0.5 bg-green-50 dark:bg-green-950/30">
            <Text className="text-green-500 dark:text-green-400 text-[9px] w-6 text-right mr-2 font-mono opacity-80">
              {i + 1}
            </Text>
            <Text className="text-green-700 dark:text-green-300 text-xs font-mono flex-1">
              +{theirLine}
            </Text>
          </View>
        )
      }
    }
  }

  return <>{rows}</>
}
