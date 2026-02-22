import React, { useCallback, useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, ChevronDown, Check, Clock } from 'lucide-react-native'

import {
  currentBranch,
  listBranches,
  diffSummary,
  diffFile,
  getLog,
} from '@/services/gitService'

/* ─────────── types ─────────── */
type ChangedFile = { filepath: string; type: string }
type DiffView = {
  filepath: string
  oldContent: string | null
  newContent: string | null
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

/* ═══════════ COMPONENT ═══════════ */
export default function CompareScreen() {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name: string }>()

  const [branches, setBranches] = useState<string[]>([])
  const [baseBranch, setBaseBranch] = useState<string>('')
  const [compareBranch, setCompareBranch] = useState<string>('')
  const [showBasePicker, setShowBasePicker] = useState(false)
  const [showComparePicker, setShowComparePicker] = useState(false)

  const [changes, setChanges] = useState<ChangedFile[]>([])
  const [loading, setLoading] = useState(false)
  const [compared, setCompared] = useState(false)

  /* Diff expansion */
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState<DiffView | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  /* Commits ahead */
  const [commitsAhead, setCommitsAhead] = useState<
    { oid: string; message: string; author: string; timestamp: number }[]
  >([])

  /* ─── init ─── */
  useEffect(() => {
    if (!name) return
    ;(async () => {
      const [br, brs] = await Promise.all([
        currentBranch(name).catch(() => 'main'),
        listBranches(name).catch(() => []),
      ])
      setBranches(brs)
      setBaseBranch(br ?? 'main')
      // Pick first branch that isn't current
      const other = brs.find((b: string) => b !== br)
      setCompareBranch(other ?? '')
    })()
  }, [name])

  /* ─── compare ─── */
  const handleCompare = useCallback(async () => {
    if (!name || !baseBranch || !compareBranch) return
    setLoading(true)
    setCompared(false)
    try {
      const [summary, log] = await Promise.all([
        diffSummary(name, baseBranch, compareBranch as any).catch(() => []),
        getLog(name, { depth: 50, ref: compareBranch }).catch(() => []),
      ])
      setChanges(summary)
      // Show commits that are in compare but not in base (simplified)
      setCommitsAhead(
        log.slice(0, 10).map((e: any) => ({
          oid: e.oid,
          message: e.commit?.message ?? '',
          author: e.commit?.author?.name ?? 'Unknown',
          timestamp: e.commit?.author?.timestamp ?? 0,
        })),
      )
      setCompared(true)
    } finally {
      setLoading(false)
    }
  }, [name, baseBranch, compareBranch])

  /* ─── expand file diff ─── */
  const handleExpandFile = useCallback(
    async (filepath: string) => {
      if (expandedFile === filepath) {
        setExpandedFile(null)
        setFileDiff(null)
        return
      }
      setExpandedFile(filepath)
      setLoadingDiff(true)
      try {
        const diff = await diffFile(
          name!,
          filepath,
          baseBranch,
          compareBranch as any,
        )
        setFileDiff({
          filepath,
          oldContent:
            typeof diff.oldContent === 'string' ? diff.oldContent : null,
          newContent:
            typeof diff.newContent === 'string' ? diff.newContent : null,
        })
      } catch {
        setFileDiff({ filepath, oldContent: null, newContent: null })
      } finally {
        setLoadingDiff(false)
      }
    },
    [name, baseBranch, compareBranch, expandedFile],
  )

  if (!name) {
    return (
      <View className="flex-1 bg-neutral-100 dark:bg-black items-center justify-center">
        <Text className="text-black dark:text-neutral-100">Invalid repository</Text>
      </View>
    )
  }

  /* ═══════ RENDER ═══════ */
  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-14 pb-4 border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} className="p-2">
          <ChevronLeft size={24} color="#58a6ff" />
        </TouchableOpacity>
        <View className="flex-1 items-center">
          <Text className="text-black dark:text-neutral-100 text-lg font-bold">
            Compare Branches
          </Text>
          <Text className="text-neutral-500 text-xs">{name}</Text>
        </View>
        <View className="w-8" />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Branch selectors */}
        <View className="px-5 mt-5">
          <View className="flex-row items-center gap-3 mb-4">
            {/* Base branch */}
            <View className="flex-1">
              <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider mb-2">Base</Text>
              <TouchableOpacity
                className="flex-row items-center px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 "
                onPress={() => {
                  setShowBasePicker(!showBasePicker)
                  setShowComparePicker(false)
                }}
              >
                <Text className="text-black dark:text-neutral-100 text-sm font-semibold flex-1">
                  {baseBranch || 'Select...'}
                </Text>
                <ChevronDown size={16} color="#8b949e" />
              </TouchableOpacity>
            </View>

            <View className="mt-6 items-center justify-center">
              <ChevronLeft size={20} color="#8b949e" />
            </View>

            {/* Compare branch */}
            <View className="flex-1">
              <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider mb-2">Compare</Text>
              <TouchableOpacity
                className="flex-row items-center px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 "
                onPress={() => {
                  setShowComparePicker(!showComparePicker)
                  setShowBasePicker(false)
                }}
              >
                <Text className="text-black dark:text-neutral-100 text-sm font-semibold flex-1">
                  {compareBranch || 'Select...'}
                </Text>
                <ChevronDown size={16} color="#8b949e" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Pickers */}
          {showBasePicker && (
            <View className="mb-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
              {branches.map((b, idx) => (
                <TouchableOpacity
                  key={b}
                  className={`px-4 py-3.5 ${idx < branches.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''} flex-row items-center justify-between`}
                  onPress={() => {
                    setBaseBranch(b)
                    setShowBasePicker(false)
                    setCompared(false)
                  }}
                >
                  <Text
                    className={
                      b === baseBranch
                        ? 'text-[#58a6ff] font-semibold text-sm'
                        : 'text-neutral-700 dark:text-neutral-300 text-sm font-medium'
                    }
                  >
                    {b}
                  </Text>
                  {b === baseBranch && (
                    <Check size={16} color="#58a6ff" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {showComparePicker && (
            <View className="mb-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
              {branches.map((b, idx) => (
                <TouchableOpacity
                  key={b}
                  className={`px-4 py-3.5 ${idx < branches.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''} flex-row items-center justify-between`}
                  onPress={() => {
                    setCompareBranch(b)
                    setShowComparePicker(false)
                    setCompared(false)
                  }}
                >
                  <Text
                    className={
                      b === compareBranch
                        ? 'text-[#58a6ff] font-semibold text-sm'
                        : 'text-neutral-700 dark:text-neutral-300 text-sm font-medium'
                    }
                  >
                    {b}
                  </Text>
                  {b === compareBranch && (
                    <Check size={16} color="#58a6ff" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Compare button */}
          <TouchableOpacity
            className={`py-3.5 rounded-xl items-center  ${baseBranch && compareBranch && baseBranch !== compareBranch ? 'bg-[#1f6feb]' : 'bg-neutral-200 dark:bg-zinc-800'}`}
            onPress={handleCompare}
            disabled={
              !baseBranch ||
              !compareBranch ||
              baseBranch === compareBranch ||
              loading
            }
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text
                className={`text-sm font-bold ${baseBranch && compareBranch && baseBranch !== compareBranch ? 'text-white' : 'text-neutral-500'}`}
              >
                Compare
              </Text>
            )}
          </TouchableOpacity>

          {baseBranch === compareBranch && baseBranch !== '' && (
            <Text className="text-[#d29922] text-xs font-semibold mt-3 text-center">
              Choose different branches to compare
            </Text>
          )}
        </View>

        {/* Results */}
        {compared && (
          <View className="px-5 mt-5">
            {/* Summary banner */}
            <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden mb-5 ">
              <View className="flex-row items-center px-4 py-3 bg-neutral-50 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
                <Text className="text-black dark:text-neutral-100 text-sm font-bold flex-1">
                  Comparison Summary
                </Text>
              </View>
              <View className="px-5 py-4 flex-row justify-between">
                <View className="items-center">
                  <Text className="text-black dark:text-neutral-100 text-xl font-bold">
                    {changes.length}
                  </Text>
                  <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider mt-1">
                    Changed
                  </Text>
                </View>
                <View className="items-center">
                  <Text className="text-[#7ee787] text-xl font-bold">
                    {changes.filter((c) => c.type === 'added').length}
                  </Text>
                  <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider mt-1">Added</Text>
                </View>
                <View className="items-center">
                  <Text className="text-[#d29922] text-xl font-bold">
                    {
                      changes.filter(
                        (c) =>
                          c.type === 'modified' ||
                          c.type === 'unknown',
                      ).length
                    }
                  </Text>
                  <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider mt-1">Modified</Text>
                </View>
                <View className="items-center">
                  <Text className="text-[#f85149] text-xl font-bold">
                    {changes.filter((c) => c.type === 'deleted').length}
                  </Text>
                  <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider mt-1">Deleted</Text>
                </View>
              </View>
            </View>

            {/* Commits */}
            {commitsAhead.length > 0 && (
              <View className="mb-5">
                <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider mb-2 ml-1">
                  Commits on {compareBranch}
                </Text>
                <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                  {commitsAhead.map((c, idx) => (
                    <View
                      key={c.oid}
                      className={`flex-row items-start px-4 py-3.5 ${idx < commitsAhead.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                    >
                      <View className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-zinc-800 mr-3.5 items-center justify-center">
                        <Text className="text-neutral-700 dark:text-neutral-300 text-xs font-bold">
                          {c.author.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View className="flex-1 mt-0.5">
                        <Text
                          className="text-black dark:text-neutral-100 text-sm font-medium leading-tight mb-1.5"
                          numberOfLines={2}
                        >
                          {c.message.trim()}
                        </Text>
                        <Text className="text-neutral-500 text-xs font-medium">
                          {c.author}
                        </Text>
                        <View className="flex-row items-center border-t border-neutral-200 dark:border-zinc-800/50 mt-2 pt-2 gap-3">
                          <View className="flex-row items-center gap-1.5">
                            <Clock size={12} color="#8b949e" />
                            <Text className="text-neutral-500 text-[11px] font-bold">
                              {timeAgo(c.timestamp)}
                            </Text>
                          </View>
                          <Text className="text-neutral-400 dark:text-neutral-500 text-[11px] font-mono tracking-wider ml-auto">
                            {c.oid.slice(0, 7)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Changed files list */}
            <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider mb-2 ml-1">
              Files Changed
            </Text>
            {changes.length === 0 ? (
              <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 px-4 py-8 items-center ">
                <Text className="text-[#7ee787] text-sm font-bold">
                  ✓ No differences found
                </Text>
              </View>
            ) : (
              <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
                {changes.map((f, idx) => (
                  <View key={f.filepath}>
                    <TouchableOpacity
                      className={`flex-row items-center px-4 py-3.5 ${idx < changes.length - 1 || expandedFile === f.filepath ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                      onPress={() => handleExpandFile(f.filepath)}
                    >
                      <Text
                        className="text-sm font-extrabold w-6 text-center "
                        style={{
                          color: f.type === 'added'
                            ? '#7ee787'
                            : f.type === 'deleted'
                              ? '#f85149'
                              : '#d29922',
                        }}
                      >
                        {f.type === 'added'
                          ? '+'
                          : f.type === 'deleted'
                            ? '−'
                            : '~'}
                      </Text>
                      <Text
                        className="text-black dark:text-neutral-200 text-sm font-medium flex-1 px-2"
                        numberOfLines={1}
                      >
                        {f.filepath}
                      </Text>
                      {expandedFile === f.filepath ? (
                        <ChevronDown size={18} color="#8b949e" />
                      ) : (
                        <ChevronRight size={18} color="#8b949e" />
                      )}
                    </TouchableOpacity>

                    {/* Expanded diff */}
                    {expandedFile === f.filepath && (
                      <View className="bg-neutral-50 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
                        {loadingDiff ? (
                          <View className="py-6 items-center">
                            <ActivityIndicator color="#58a6ff" size="small" />
                          </View>
                        ) : fileDiff ? (
                          <ScrollView
                            horizontal
                            style={{ maxHeight: 400 }}
                            nestedScrollEnabled
                          >
                            <View className="p-3 min-w-full">
                              {renderUnifiedDiff(
                                fileDiff.oldContent,
                                fileDiff.newContent,
                              )}
                            </View>
                          </ScrollView>
                        ) : null}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

/* ─── Simple unified diff renderer ─── */
function renderUnifiedDiff(
  oldContent: string | null,
  newContent: string | null,
) {
  const oldLines = (oldContent ?? '').split('\n')
  const newLines = (newContent ?? '').split('\n')
  const maxLen = Math.max(oldLines.length, newLines.length)
  const rows: React.ReactElement[] = []

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]

    if (oldLine === newLine) {
      rows.push(
        <View key={i} className="flex-row items-center py-0.5 pr-4">
          <Text className="text-neutral-400 dark:text-neutral-500 text-[10px] w-6 text-right mr-3 font-mono opacity-80">
            {i + 1}
          </Text>
          <Text className="text-neutral-600 dark:text-neutral-400 text-[11px] font-mono leading-tight">
            {'  '}
            {oldLine ?? ''}
          </Text>
        </View>,
      )
    } else {
      if (
        oldLine !== undefined &&
        (newLine === undefined || oldLine !== newLine)
      ) {
        rows.push(
          <View key={`${i}-old`} className="flex-row items-center py-0.5 bg-red-50 dark:bg-red-950/30 pr-4">
            <Text className="text-red-400 text-[10px] w-6 text-right mr-3 font-mono opacity-80">
              {i + 1}
            </Text>
            <Text className="text-red-600 dark:text-red-400 text-[11px] font-mono leading-tight">
              {'- '}
              {oldLine}
            </Text>
          </View>,
        )
      }
      if (
        newLine !== undefined &&
        (oldLine === undefined || oldLine !== newLine)
      ) {
        rows.push(
          <View key={`${i}-new`} className="flex-row items-center py-0.5 bg-green-50 dark:bg-green-950/30 pr-4">
            <Text className="text-green-500 text-[10px] w-6 text-right mr-3 font-mono opacity-80">
              {i + 1}
            </Text>
            <Text className="text-green-600 dark:text-green-400 text-[11px] font-mono leading-tight">
              {'+ '}
              {newLine}
            </Text>
          </View>,
        )
      }
    }
  }

  return <>{rows}</>
}
