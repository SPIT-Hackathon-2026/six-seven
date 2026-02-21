import React, { useCallback, useState, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import {
  currentBranch,
  listBranches,
  getLog,
  resolveRef,
} from '@/services/gitService'

/* ─────────── palette ─────────── */
const BRANCH_COLORS = [
  '#58a6ff', // blue
  '#7ee787', // green
  '#d2a8ff', // purple
  '#f78166', // orange
  '#ff7b72', // red
  '#79c0ff', // light blue
  '#ffa657', // amber
  '#d29922', // yellow
  '#e6edf3', // white
  '#bc8cff', // violet
]

/* ─────────── types ─────────── */
type GraphCommit = {
  oid: string
  shortOid: string
  message: string
  author: string
  timestamp: number
  parents: string[]
  branches: string[] // branch names whose tip is this commit
  column: number // assigned graph column
  branchColor: string
}

type BranchInfo = {
  name: string
  tipOid: string
  color: string
  column: number
}

/* ─────────── helpers ─────────── */
function timeAgo(ts: number) {
  const diff = Date.now() - ts * 1000
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

function formatDate(ts: number) {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/* ═══════════════ COMPONENT ═══════════════ */
export default function BranchGraphScreen() {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name: string }>()

  const [loading, setLoading] = useState(true)
  const [graphCommits, setGraphCommits] = useState<GraphCommit[]>([])
  const [branchInfos, setBranchInfos] = useState<BranchInfo[]>([])
  const [activeBranch, setActiveBranch] = useState<string | null>(null)
  const [current, setCurrent] = useState('main')
  const [expandedOid, setExpandedOid] = useState<string | null>(null)
  const [maxColumns, setMaxColumns] = useState(1)

  /* ─── load data ─── */
  const loadGraph = useCallback(async () => {
    if (!name) return
    setLoading(true)
    try {
      const [cur, branches] = await Promise.all([
        currentBranch(name).catch(() => 'main'),
        listBranches(name).catch(() => []),
      ])
      setCurrent(cur ?? 'main')

      // Resolve tips for each branch
      const branchTips: { name: string; oid: string }[] = []
      for (const br of branches) {
        try {
          const oid = await resolveRef(name, br)
          branchTips.push({ name: br, oid })
        } catch {
          // skip unresolvable branches
        }
      }

      // Fetch logs for each branch
      const allCommitsMap = new Map<string, GraphCommit>()
      const branchTipMap = new Map<string, string[]>() // oid -> branch names

      for (let i = 0; i < branchTips.length; i++) {
        const bt = branchTips[i]
        // track tip oid -> branch name mapping
        if (!branchTipMap.has(bt.oid)) branchTipMap.set(bt.oid, [])
        branchTipMap.get(bt.oid)!.push(bt.name)

        try {
          const log = await getLog(name, { depth: 40, ref: bt.name })
          for (const entry of log) {
            if (!allCommitsMap.has(entry.oid)) {
              allCommitsMap.set(entry.oid, {
                oid: entry.oid,
                shortOid: entry.oid.slice(0, 7),
                message: entry.commit?.message?.trim() ?? '',
                author: entry.commit?.author?.name ?? 'Unknown',
                timestamp: entry.commit?.author?.timestamp ?? 0,
                parents: entry.commit?.parent ?? [],
                branches: [],
                column: 0,
                branchColor: BRANCH_COLORS[i % BRANCH_COLORS.length],
              })
            }
          }
        } catch {
          // skip branch log failures
        }
      }

      // Assign branch labels to tip commits
      for (const [oid, brNames] of branchTipMap.entries()) {
        const c = allCommitsMap.get(oid)
        if (c) c.branches = brNames
      }

      // Sort commits by timestamp descending (newest first)
      const sorted = Array.from(allCommitsMap.values()).sort(
        (a, b) => b.timestamp - a.timestamp,
      )

      // Assign columns using a simple graph layout algorithm
      // Each branch gets its own column; commits inherit column from their branch
      const infos: BranchInfo[] = branchTips.map((bt, i) => ({
        name: bt.name,
        tipOid: bt.oid,
        color: BRANCH_COLORS[i % BRANCH_COLORS.length],
        column: i,
      }))

      // Build oid -> branch column mappings by tracing each branch's log
      const oidColumnMap = new Map<string, number>()
      const oidColorMap = new Map<string, string>()

      for (let i = 0; i < branchTips.length; i++) {
        try {
          const log = await getLog(name, { depth: 40, ref: branchTips[i].name })
          for (const entry of log) {
            // First branch to claim a commit wins (the branch whose tip reached it first)
            if (!oidColumnMap.has(entry.oid)) {
              oidColumnMap.set(entry.oid, i)
              oidColorMap.set(
                entry.oid,
                BRANCH_COLORS[i % BRANCH_COLORS.length],
              )
            }
          }
        } catch {}
      }

      // Apply column assignments
      for (const c of sorted) {
        c.column = oidColumnMap.get(c.oid) ?? 0
        c.branchColor = oidColorMap.get(c.oid) ?? BRANCH_COLORS[0]
      }

      const cols = branchTips.length || 1
      setMaxColumns(cols)
      setBranchInfos(infos)
      setGraphCommits(sorted)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [name])

  useEffect(() => {
    loadGraph()
  }, [loadGraph])

  /* ─── derived: filter by active branch ─── */
  const visibleCommits = useMemo(() => {
    if (!activeBranch) return graphCommits
    const info = branchInfos.find((b) => b.name === activeBranch)
    if (!info) return graphCommits
    return graphCommits.filter((c) => c.column === info.column)
  }, [graphCommits, activeBranch, branchInfos])

  /* ─── guard ─── */
  if (!name) {
    return (
      <View className="flex-1 bg-neutral-100 dark:bg-black items-center justify-center">
        <Text className="text-black dark:text-neutral-100">Invalid repository</Text>
      </View>
    )
  }

  const COL_WIDTH = 28
  const GRAPH_LEFT = 16
  const NODE_SIZE = 12

  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black">
      {/* ── Header ── */}
      <View className="flex-row items-center justify-between px-4 pt-14 pb-4 border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} className="p-2">
          <Text className="text-[#58a6ff] text-2xl font-bold">‹</Text>
        </TouchableOpacity>
        <View className="flex-1 items-center">
          <Text className="text-black dark:text-neutral-100 text-lg font-bold">Branch Graph</Text>
          <Text className="text-neutral-500 text-xs font-medium">{name}</Text>
        </View>
        <View className="w-8" />
      </View>

      {/* ── Branch filter chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50"
      >
        <View className="flex-row px-4 py-3 gap-2 items-center">
          <TouchableOpacity
            className={`px-4 py-2 rounded-xl border  ${
              activeBranch === null
                ? 'bg-blue-50 dark:bg-zinc-800 border-[#1f6feb] dark:border-[#58a6ff]'
                : 'bg-white dark:bg-black border-neutral-200 dark:border-zinc-800'
            }`}
            onPress={() => setActiveBranch(null)}
          >
            <Text
              className={`text-xs font-bold tracking-wide uppercase ${activeBranch === null ? 'text-[#1f6feb] dark:text-[#58a6ff]' : 'text-neutral-500'}`}
            >
              All
            </Text>
          </TouchableOpacity>
          {branchInfos.map((bi) => (
            <TouchableOpacity
              key={bi.name}
              className={`flex-row items-center gap-2 px-4 py-2 rounded-xl border  ${
                activeBranch === bi.name
                  ? 'bg-neutral-50 dark:bg-zinc-800 border-[' + bi.color + ']'
                  : 'bg-white dark:bg-black border-neutral-200 dark:border-zinc-800'
              }`}
              onPress={() =>
                setActiveBranch(activeBranch === bi.name ? null : bi.name)
              }
            >
              <View
                className="w-3 h-3 rounded-full "
                style={{ backgroundColor: bi.color }}
              />
              <Text
                className={`text-xs ${activeBranch === bi.name ? 'text-black dark:text-neutral-100 font-bold' : 'text-neutral-500 font-medium'}`}
              >
                {bi.name}
              </Text>
              {bi.name === current && (
                <Text className="text-[#7ee787] text-[10px] ml-1 font-bold">★</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ── Legend ── */}
      <View className="px-5 py-3 border-b border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-black">
        <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider">
          {branchInfos.length} branch{branchInfos.length !== 1 ? 'es' : ''} ·{' '}
          {graphCommits.length} commits ·{' '}
          {activeBranch ? `Showing ${activeBranch}` : 'Showing all branches'}
        </Text>
      </View>

      {/* ── Graph ── */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={loadGraph}
            tintColor="#58a6ff"
          />
        }
      >
        {loading ? (
          <View className="mt-8 items-center">
            <ActivityIndicator color="#58a6ff" size="large" />
            <Text className="text-neutral-500 mt-4 text-sm font-medium">
              Building graph...
            </Text>
          </View>
        ) : visibleCommits.length === 0 ? (
          <View className="mt-8 items-center">
            <Text className="text-neutral-500 text-sm font-medium">No commits found</Text>
          </View>
        ) : (
          <View style={{ paddingLeft: GRAPH_LEFT }}>
            {visibleCommits.map((commit, idx) => {
              const isExpanded = expandedOid === commit.oid
              const isMerge = commit.parents.length > 1
              const isLast = idx === visibleCommits.length - 1

              return (
                <View key={commit.oid}>
                  <TouchableOpacity
                    className="flex-row"
                    activeOpacity={0.7}
                    onPress={() =>
                      setExpandedOid(isExpanded ? null : commit.oid)
                    }
                  >
                    {/* ── Graph lines ── */}
                    <View
                      style={{ width: COL_WIDTH * maxColumns + 8 }}
                      className="items-start"
                    >
                      {/* Vertical lines for each active column */}
                      <View className="absolute top-0 bottom-0 left-0 right-0">
                        {branchInfos.map((bi) => {
                          if (activeBranch !== null && bi.name !== activeBranch)
                            return null
                          return (
                            <View
                              key={bi.name}
                              className="absolute top-0 bottom-0"
                              style={{
                                left: bi.column * COL_WIDTH + NODE_SIZE / 2,
                                width: 2,
                                backgroundColor: bi.color + '33',
                              }}
                            />
                          )
                        })}
                      </View>

                      {/* Commit node */}
                      <View
                        style={{
                          left: commit.column * COL_WIDTH,
                          top: 14,
                          width: NODE_SIZE,
                          height: NODE_SIZE,
                          borderRadius: isMerge ? 2 : NODE_SIZE / 2,
                          backgroundColor: commit.branchColor,
                          borderWidth: isMerge ? 2 : 0,
                          borderColor: 'black',
                          zIndex: 2,
                        }}
                      />

                      {/* Merge line (diagonal from parent column) */}
                      {isMerge && (
                        <View
                          className="absolute"
                          style={{
                            top: 20,
                            left: commit.column * COL_WIDTH + NODE_SIZE / 2,
                            width:
                              Math.abs(
                                ((branchInfos.find(
                                  (b) => b.column !== commit.column,
                                )?.column ?? commit.column + 1) -
                                  commit.column) *
                                  COL_WIDTH,
                              ) || COL_WIDTH,
                            height: 2,
                            backgroundColor: commit.branchColor + '66',
                          }}
                        />
                      )}
                    </View>

                    {/* ── Commit details ── */}
                    <View
                      className={`flex-1 py-3 pr-4 ml-2 ${!isLast ? 'border-b border-neutral-200 dark:border-zinc-800' : ''}`}
                    >
                      {/* Branch labels */}
                      {commit.branches.length > 0 && (
                        <View className="flex-row flex-wrap gap-2 mb-2">
                          {commit.branches.map((br) => {
                            const info = branchInfos.find((b) => b.name === br)
                            const color = info?.color ?? '#58a6ff'
                            return (
                              <View
                                key={br}
                                className="flex-row items-center gap-1.5 px-2 py-1 rounded-md "
                                style={{
                                  backgroundColor: color + '22',
                                  borderWidth: 1,
                                  borderColor: color + '66',
                                }}
                              >
                                <View
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: color }}
                                />
                                <Text
                                  className="text-[10px] font-bold uppercase tracking-wider"
                                  style={{ color }}
                                >
                                  {br}
                                </Text>
                                {br === current && (
                                  <Text className="text-[#7ee787] text-[10px] ml-0.5">
                                    ★
                                  </Text>
                                )}
                              </View>
                            )
                          })}
                        </View>
                      )}

                      {/* Commit message */}
                      <Text
                        className="text-black dark:text-neutral-100 text-[13px] font-medium leading-snug"
                        numberOfLines={isExpanded ? undefined : 1}
                      >
                        {commit.message.split('\n')[0]}
                      </Text>

                      {/* Meta */}
                      <View className="flex-row items-center mt-2 gap-3 flex-wrap">
                        <Text className="text-neutral-400 dark:text-neutral-500 text-xs font-mono font-bold tracking-wider">
                          {commit.shortOid}
                        </Text>
                        <View className="w-1 h-1 rounded-full bg-neutral-300 dark:bg-zinc-700" />
                        <Text className="text-neutral-500 text-xs font-medium">
                          {commit.author}
                        </Text>
                        <View className="w-1 h-1 rounded-full bg-neutral-300 dark:bg-zinc-700" />
                        <Text className="text-neutral-500 text-xs font-medium">
                          {timeAgo(commit.timestamp)}
                        </Text>
                        {isMerge && (
                          <View className="px-1.5 py-0.5 rounded ml-2 border border-[#d2a8ff]/30 bg-[#d2a8ff]/10">
                            <Text className="text-[#d2a8ff] text-[9px] font-bold tracking-wider">
                              MERGE
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Expanded details */}
                      {isExpanded && (
                        <View className="mt-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4  mb-2">
                          <Text className="text-neutral-400 dark:text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                            Full commit hash
                          </Text>
                          <Text className="text-black dark:text-neutral-200 text-xs font-mono font-medium mb-3">
                            {commit.oid}
                          </Text>

                          {commit.message.includes('\n') && (
                            <>
                              <Text className="text-neutral-400 dark:text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                                Full message
                              </Text>
                              <Text className="text-black dark:text-neutral-300 text-xs mb-3 leading-relaxed">
                                {commit.message}
                              </Text>
                            </>
                          )}

                          <View className="flex-row mb-3">
                            <View className="flex-1">
                              <Text className="text-neutral-400 dark:text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                                Author
                              </Text>
                              <Text className="text-black dark:text-neutral-200 text-xs font-medium">
                                {commit.author}
                              </Text>
                            </View>

                            <View className="flex-1">
                              <Text className="text-neutral-400 dark:text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                                Date
                              </Text>
                              <Text className="text-black dark:text-neutral-200 text-xs font-medium">
                                {formatDate(commit.timestamp)}
                              </Text>
                            </View>
                          </View>

                          <Text className="text-neutral-400 dark:text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                            Parents ({commit.parents.length})
                          </Text>
                          <View className="flex-row flex-wrap gap-2">
                            {commit.parents.map((p) => (
                              <Text
                                key={p}
                                className="text-[#1f6feb] dark:text-[#58a6ff] text-xs font-mono font-medium"
                              >
                                {p.slice(0, 7)}
                              </Text>
                            ))}
                          </View>

                          {commit.branches.length > 0 && (
                            <>
                              <Text className="text-neutral-400 dark:text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 mt-3">
                                Branch tips
                              </Text>
                              <Text className="text-[#238636] dark:text-[#7ee787] text-xs font-medium">
                                {commit.branches.join(', ')}
                              </Text>
                            </>
                          )}
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
  )
}
