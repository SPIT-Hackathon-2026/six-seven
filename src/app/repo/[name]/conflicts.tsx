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
} from '@/services/gitService'

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
      await commit(
        name,
        `Merge ${theirBranch} into ${branch} (resolved conflicts)`,
      )
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
      <View className="flex-1 bg-[#0d1117] items-center justify-center">
        <Text className="text-[#e6edf3]">No conflicts to resolve</Text>
        <TouchableOpacity className="mt-4" onPress={() => router.back()}>
          <Text className="text-[#58a6ff]">Go back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const current = files[activeFile]

  /* ═══════ RENDER ═══════ */
  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-14 pb-3 border-b border-[#30363d] bg-[#161b22]">
        <TouchableOpacity onPress={() => router.back()} className="p-1">
          <Text className="text-[#58a6ff] text-2xl font-bold">‹</Text>
        </TouchableOpacity>
        <View className="flex-1 items-center">
          <Text className="text-[#e6edf3] text-lg font-bold">
            Merge Conflicts
          </Text>
          <Text className="text-[#8b949e] text-[11px]">
            {branch} ← {theirBranch}
          </Text>
        </View>
        <View className="w-8" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#58a6ff" size="large" />
          <Text className="text-[#8b949e] mt-3 text-sm">
            Loading conflict details...
          </Text>
        </View>
      ) : showEditor && current ? (
        /* ─── Manual editor ─── */
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d]">
            <TouchableOpacity onPress={() => setShowEditor(false)}>
              <Text className="text-[#58a6ff] text-sm">← Cancel</Text>
            </TouchableOpacity>
            <Text className="text-[#e6edf3] text-sm" numberOfLines={1}>
              {current.filepath}
            </Text>
            <TouchableOpacity onPress={applyManualEdit}>
              <Text className="text-[#7ee787] text-sm font-semibold">
                Apply
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            className="flex-1 bg-[#0d1117] text-[#e6edf3] p-4 font-mono text-xs"
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
            className="border-b border-[#30363d]"
          >
            <View className="flex-row px-2 py-2 gap-1">
              {files.map((f, idx) => (
                <TouchableOpacity
                  key={f.filepath}
                  className={`px-3 py-1.5 rounded-md ${idx === activeFile ? 'bg-[#21262d] border border-[#30363d]' : ''}`}
                  onPress={() => setActiveFile(idx)}
                >
                  <View className="flex-row items-center gap-1.5">
                    {f.resolved !== null ? (
                      <Text className="text-[#7ee787] text-xs">✓</Text>
                    ) : (
                      <Text className="text-[#f85149] text-xs">●</Text>
                    )}
                    <Text
                      className={
                        idx === activeFile
                          ? 'text-[#e6edf3] text-xs'
                          : 'text-[#8b949e] text-xs'
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
          <View className="px-4 mt-3">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-[#8b949e] text-xs">
                {files.filter((f) => f.resolved !== null).length} /{' '}
                {files.length} resolved
              </Text>
              <Text
                className={`text-xs ${allResolved ? 'text-[#7ee787]' : 'text-[#d29922]'}`}
              >
                {allResolved ? 'All resolved ✓' : 'Pending...'}
              </Text>
            </View>
            <View className="h-1.5 rounded-full bg-[#21262d] overflow-hidden">
              <View
                className="h-full rounded-full bg-[#238636]"
                style={{
                  width: `${(files.filter((f) => f.resolved !== null).length / files.length) * 100}%`,
                }}
              />
            </View>
          </View>

          {current && (
            <View className="px-4 mt-3">
              {/* File path */}
              <Text className="text-[#e6edf3] text-sm font-semibold mb-3">
                {current.filepath}
              </Text>

              {/* Strategy buttons */}
              <View className="flex-row gap-2 mb-3">
                <TouchableOpacity
                  className={`flex-1 py-2.5 rounded-lg items-center border ${
                    current.strategy === 'ours'
                      ? 'bg-[#1f6feb33] border-[#1f6feb]'
                      : 'bg-[#21262d] border-[#30363d]'
                  }`}
                  onPress={() => chooseStrategy(activeFile, 'ours')}
                >
                  <Text className="text-[#58a6ff] text-sm font-semibold">
                    Accept Ours
                  </Text>
                  <Text className="text-[#8b949e] text-[10px]">{branch}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className={`flex-1 py-2.5 rounded-lg items-center border ${
                    current.strategy === 'theirs'
                      ? 'bg-[#238636]33 border-[#238636]'
                      : 'bg-[#21262d] border-[#30363d]'
                  }`}
                  onPress={() => chooseStrategy(activeFile, 'theirs')}
                >
                  <Text className="text-[#7ee787] text-sm font-semibold">
                    Accept Theirs
                  </Text>
                  <Text className="text-[#8b949e] text-[10px]">
                    {theirBranch}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className={`flex-1 py-2.5 rounded-lg items-center border ${
                    current.strategy === 'manual'
                      ? 'bg-[#d29922]33 border-[#d29922]'
                      : 'bg-[#21262d] border-[#30363d]'
                  }`}
                  onPress={() => {
                    setEditContent(current.ours ?? current.theirs ?? '')
                    setShowEditor(true)
                  }}
                >
                  <Text className="text-[#d29922] text-sm font-semibold">
                    Edit
                  </Text>
                  <Text className="text-[#8b949e] text-[10px]">Manual</Text>
                </TouchableOpacity>
              </View>

              {/* Side-by-side diff view */}
              <View className="flex-row gap-2">
                {/* Ours */}
                <View className="flex-1 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                  <View className="px-2 py-1.5 bg-[#1f6feb22] border-b border-[#30363d]">
                    <Text className="text-[#58a6ff] text-[11px] font-semibold">
                      Ours ({branch})
                    </Text>
                  </View>
                  <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled>
                    <View className="p-2">
                      {(current.ours ?? '(empty)')
                        .split('\n')
                        .map((line, i) => (
                          <Text
                            key={i}
                            className="text-[#e6edf3] text-[10px] font-mono"
                          >
                            {line || ' '}
                          </Text>
                        ))}
                    </View>
                  </ScrollView>
                </View>

                {/* Theirs */}
                <View className="flex-1 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                  <View className="px-2 py-1.5 bg-[#238636]22 border-b border-[#30363d]">
                    <Text className="text-[#7ee787] text-[11px] font-semibold">
                      Theirs ({theirBranch})
                    </Text>
                  </View>
                  <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled>
                    <View className="p-2">
                      {(current.theirs ?? '(empty)')
                        .split('\n')
                        .map((line, i) => (
                          <Text
                            key={i}
                            className="text-[#e6edf3] text-[10px] font-mono"
                          >
                            {line || ' '}
                          </Text>
                        ))}
                    </View>
                  </ScrollView>
                </View>
              </View>

              {/* Base version (collapsible) */}
              {current.base && (
                <View className="mt-3 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                  <View className="px-2 py-1.5 bg-[#21262d] border-b border-[#30363d]">
                    <Text className="text-[#8b949e] text-[11px] font-semibold">
                      Base (common ancestor)
                    </Text>
                  </View>
                  <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                    <View className="p-2">
                      {current.base.split('\n').map((line, i) => (
                        <Text
                          key={i}
                          className="text-[#8b949e] text-[10px] font-mono"
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
                <View className="mt-3 rounded-lg bg-[#0d1117] border border-[#238636] overflow-hidden">
                  <View className="px-2 py-1.5 bg-[#238636]22 border-b border-[#238636]">
                    <Text className="text-[#7ee787] text-[11px] font-semibold">
                      ✓ Resolved ({current.strategy})
                    </Text>
                  </View>
                  <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                    <View className="p-2">
                      {current.resolved.split('\n').map((line, i) => (
                        <Text
                          key={i}
                          className="text-[#e6edf3] text-[10px] font-mono"
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
          <View className="px-4 mt-4">
            <TouchableOpacity
              className={`py-3 rounded-lg items-center ${allResolved ? 'bg-[#238636]' : 'bg-[#21262d]'}`}
              onPress={handleResolveAll}
              disabled={!allResolved || resolving}
            >
              {resolving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text
                  className={`text-sm font-semibold ${allResolved ? 'text-white' : 'text-[#484f58]'}`}
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
