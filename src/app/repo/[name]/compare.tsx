import React, { useCallback, useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import {
  currentBranch,
  listBranches,
  diffSummary,
  diffFile,
  getLog,
} from '@/services/gitService'

/* ─────────── types ─────────── */
type ChangedFile = { filepath: string; status: string }
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
        const diff = await diffFile(name!, filepath, baseBranch, compareBranch as any)
        setFileDiff({ filepath, oldContent: typeof diff.oldContent === 'string' ? diff.oldContent : null, newContent: typeof diff.newContent === 'string' ? diff.newContent : null })
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
      <View className="flex-1 bg-[#0d1117] items-center justify-center">
        <Text className="text-[#e6edf3]">Invalid repository</Text>
      </View>
    )
  }

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
            Compare Branches
          </Text>
          <Text className="text-[#8b949e] text-[11px]">{name}</Text>
        </View>
        <View className="w-8" />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Branch selectors */}
        <View className="px-4 mt-4">
          <View className="flex-row items-center gap-2 mb-3">
            {/* Base branch */}
            <View className="flex-1">
              <Text className="text-[#8b949e] text-xs mb-1">Base</Text>
              <TouchableOpacity
                className="flex-row items-center px-3 py-2 rounded-md bg-[#21262d] border border-[#30363d]"
                onPress={() => {
                  setShowBasePicker(!showBasePicker)
                  setShowComparePicker(false)
                }}
              >
                <Text className="text-[#e6edf3] text-sm flex-1">
                  {baseBranch || 'Select...'}
                </Text>
                <Text className="text-[#8b949e] text-xs">▼</Text>
              </TouchableOpacity>
            </View>

            <Text className="text-[#484f58] text-lg mt-4">←</Text>

            {/* Compare branch */}
            <View className="flex-1">
              <Text className="text-[#8b949e] text-xs mb-1">Compare</Text>
              <TouchableOpacity
                className="flex-row items-center px-3 py-2 rounded-md bg-[#21262d] border border-[#30363d]"
                onPress={() => {
                  setShowComparePicker(!showComparePicker)
                  setShowBasePicker(false)
                }}
              >
                <Text className="text-[#e6edf3] text-sm flex-1">
                  {compareBranch || 'Select...'}
                </Text>
                <Text className="text-[#8b949e] text-xs">▼</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Pickers */}
          {showBasePicker && (
            <View className="mb-2 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
              {branches.map((b) => (
                <TouchableOpacity
                  key={b}
                  className="px-3 py-2 border-b border-[#21262d] flex-row items-center justify-between"
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
                        : 'text-[#c9d1d9] text-sm'
                    }
                  >
                    {b}
                  </Text>
                  {b === baseBranch && (
                    <Text className="text-[#58a6ff] text-xs">✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {showComparePicker && (
            <View className="mb-2 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
              {branches.map((b) => (
                <TouchableOpacity
                  key={b}
                  className="px-3 py-2 border-b border-[#21262d] flex-row items-center justify-between"
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
                        : 'text-[#c9d1d9] text-sm'
                    }
                  >
                    {b}
                  </Text>
                  {b === compareBranch && (
                    <Text className="text-[#58a6ff] text-xs">✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Compare button */}
          <TouchableOpacity
            className={`py-2.5 rounded-lg items-center ${baseBranch && compareBranch && baseBranch !== compareBranch ? 'bg-[#238636]' : 'bg-[#21262d]'}`}
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
                className={`text-sm font-semibold ${baseBranch && compareBranch && baseBranch !== compareBranch ? 'text-white' : 'text-[#484f58]'}`}
              >
                Compare
              </Text>
            )}
          </TouchableOpacity>

          {baseBranch === compareBranch && baseBranch !== '' && (
            <Text className="text-[#d29922] text-xs mt-2 text-center">
              Choose different branches to compare
            </Text>
          )}
        </View>

        {/* Results */}
        {compared && (
          <View className="px-4 mt-4">
            {/* Summary banner */}
            <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden mb-4">
              <View className="flex-row items-center px-3 py-2 bg-[#21262d] border-b border-[#30363d]">
                <Text className="text-[#e6edf3] text-sm font-semibold flex-1">
                  Comparison Summary
                </Text>
              </View>
              <View className="px-3 py-3 flex-row gap-4">
                <View className="items-center">
                  <Text className="text-[#e6edf3] text-lg font-bold">
                    {changes.length}
                  </Text>
                  <Text className="text-[#8b949e] text-xs">
                    File{changes.length !== 1 ? 's' : ''} changed
                  </Text>
                </View>
                <View className="items-center">
                  <Text className="text-[#7ee787] text-lg font-bold">
                    {changes.filter((c) => c.status.includes('added')).length}
                  </Text>
                  <Text className="text-[#8b949e] text-xs">Added</Text>
                </View>
                <View className="items-center">
                  <Text className="text-[#d29922] text-lg font-bold">
                    {
                      changes.filter(
                        (c) =>
                          c.status.includes('modified') ||
                          c.status === 'unknown',
                      ).length
                    }
                  </Text>
                  <Text className="text-[#8b949e] text-xs">Modified</Text>
                </View>
                <View className="items-center">
                  <Text className="text-[#f85149] text-lg font-bold">
                    {changes.filter((c) => c.status.includes('deleted')).length}
                  </Text>
                  <Text className="text-[#8b949e] text-xs">Deleted</Text>
                </View>
              </View>
            </View>

            {/* Commits */}
            {commitsAhead.length > 0 && (
              <View className="mb-4">
                <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-2">
                  Commits on {compareBranch}
                </Text>
                <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                  {commitsAhead.map((c, idx) => (
                    <View
                      key={c.oid}
                      className={`flex-row items-start px-3 py-2.5 ${idx < commitsAhead.length - 1 ? 'border-b border-[#21262d]' : ''}`}
                    >
                      <View className="w-5 h-5 rounded-full bg-[#21262d] mr-2 items-center justify-center mt-0.5">
                        <Text className="text-[#8b949e] text-[9px]">
                          {c.author.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-[#e6edf3] text-sm"
                          numberOfLines={1}
                        >
                          {c.message.trim()}
                        </Text>
                        <Text className="text-[#484f58] text-xs mt-0.5">
                          {c.author} · {timeAgo(c.timestamp)} ·{' '}
                          <Text className="font-mono">
                            {c.oid.slice(0, 7)}
                          </Text>
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Changed files list */}
            <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-2">
              Files Changed
            </Text>
            {changes.length === 0 ? (
              <View className="rounded-lg bg-[#161b22] border border-[#30363d] px-3 py-6 items-center">
                <Text className="text-[#7ee787] text-sm">
                  ✓ No differences found
                </Text>
              </View>
            ) : (
              <View className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                {changes.map((f, idx) => (
                  <View key={f.filepath}>
                    <TouchableOpacity
                      className={`flex-row items-center px-3 py-2.5 ${idx < changes.length - 1 || expandedFile === f.filepath ? 'border-b border-[#21262d]' : ''}`}
                      onPress={() => handleExpandFile(f.filepath)}
                    >
                      <Text
                        className="text-xs font-bold w-5"
                        style={{
                          color: f.status.includes('added')
                            ? '#7ee787'
                            : f.status.includes('deleted')
                              ? '#f85149'
                              : '#d29922',
                        }}
                      >
                        {f.status.includes('added')
                          ? '+'
                          : f.status.includes('deleted')
                            ? '−'
                            : '~'}
                      </Text>
                      <Text
                        className="text-[#e6edf3] text-sm flex-1"
                        numberOfLines={1}
                      >
                        {f.filepath}
                      </Text>
                      <Text className="text-[#484f58] text-xs">
                        {expandedFile === f.filepath ? '▼' : '›'}
                      </Text>
                    </TouchableOpacity>

                    {/* Expanded diff */}
                    {expandedFile === f.filepath && (
                      <View className="bg-[#0d1117] border-b border-[#21262d]">
                        {loadingDiff ? (
                          <View className="py-3 items-center">
                            <ActivityIndicator color="#58a6ff" size="small" />
                          </View>
                        ) : fileDiff ? (
                          <ScrollView
                            horizontal
                            style={{ maxHeight: 300 }}
                            nestedScrollEnabled
                          >
                            <View className="p-2 min-w-full">
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
        <View key={i} className="flex-row">
          <Text className="text-[#484f58] text-[10px] w-6 text-right mr-1 font-mono">
            {i + 1}
          </Text>
          <Text className="text-[#e6edf3] text-[10px] font-mono">
            {'  '}{oldLine ?? ''}
          </Text>
        </View>,
      )
    } else {
      if (oldLine !== undefined && (newLine === undefined || oldLine !== newLine)) {
        rows.push(
          <View key={`${i}-old`} className="flex-row bg-[#3d1f28]">
            <Text className="text-[#f85149] text-[10px] w-6 text-right mr-1 font-mono">
              {i + 1}
            </Text>
            <Text className="text-[#ffa198] text-[10px] font-mono">
              {'- '}{oldLine}
            </Text>
          </View>,
        )
      }
      if (newLine !== undefined && (oldLine === undefined || oldLine !== newLine)) {
        rows.push(
          <View key={`${i}-new`} className="flex-row bg-[#1b3826]">
            <Text className="text-[#7ee787] text-[10px] w-6 text-right mr-1 font-mono">
              {i + 1}
            </Text>
            <Text className="text-[#aff5b4] text-[10px] font-mono">
              {'+ '}{newLine}
            </Text>
          </View>,
        )
      }
    }
  }

  return <>{rows}</>
}
