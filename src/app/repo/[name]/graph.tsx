import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Animated,
  Clipboard,
  Dimensions,
  SafeAreaView,
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
  '#ffa657', // amber
  '#ff7b72', // red
  '#79c0ff', // light-blue
  '#f2cc60', // yellow
  '#56d364', // lime
  '#bc8cff', // violet
  '#f0883e', // orange
]

/* ─────────── types ─────────── */
type GraphCommit = {
  oid: string
  shortOid: string
  message: string
  author: string
  email: string
  timestamp: number
  parents: string[]
  branches: string[]
  column: number
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
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/* ─────────── Constants ─────────── */
const COL_WIDTH = 24
const NODE_R = 6
const GRAPH_PAD = 12

/* ═══════════════ ANIMATED COMMIT ROW ═══════════════ */
function CommitRow({
  commit,
  isExpanded,
  onToggle,
  maxColumns,
  branchInfos,
  activeBranch,
  current,
  isLast,
  showAllColumns,
}: {
  commit: GraphCommit
  isExpanded: boolean
  onToggle: () => void
  maxColumns: number
  branchInfos: BranchInfo[]
  activeBranch: string | null
  current: string
  isLast: boolean
  showAllColumns: boolean
}) {
  const expandAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current

  useEffect(() => {
    Animated.spring(expandAnim, {
      toValue: isExpanded ? 1 : 0,
      useNativeDriver: false,
      tension: 120,
      friction: 14,
    }).start()
  }, [isExpanded])

  const isMerge = commit.parents.length > 1
  const graphWidth = showAllColumns ? COL_WIDTH * maxColumns + GRAPH_PAD : COL_WIDTH + GRAPH_PAD
  const nodeX = showAllColumns
    ? commit.column * COL_WIDTH + GRAPH_PAD
    : GRAPH_PAD
  const nodeY = 22 // center vertically within the row head

  return (
    <View>
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={onToggle}
        style={{ flexDirection: 'row', paddingVertical: 0 }}
      >
        {/* ── Graph lane ── */}
        <View style={{ width: graphWidth, minHeight: 48 }}>
          {/* Vertical lane lines */}
          {showAllColumns &&
            branchInfos.map((bi) => {
              if (activeBranch !== null && bi.name !== activeBranch) return null
              return (
                <View
                  key={bi.name}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: bi.column * COL_WIDTH + GRAPH_PAD + NODE_R - 1,
                    width: 2,
                    backgroundColor: bi.color + '28',
                  }}
                />
              )
            })}

          {/* Single-branch lane */}
          {!showAllColumns && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: GRAPH_PAD + NODE_R - 1,
                width: 2,
                backgroundColor: commit.branchColor + '40',
              }}
            />
          )}

          {/* Merge arc (horizontal connector) */}
          {isMerge && showAllColumns && (
            <View
              style={{
                position: 'absolute',
                top: nodeY + NODE_R - 1,
                left: nodeX + NODE_R,
                width: COL_WIDTH * 1.5,
                height: 2,
                backgroundColor: commit.branchColor + '55',
              }}
            />
          )}

          {/* Commit node */}
          <View
            style={{
              position: 'absolute',
              top: nodeY - NODE_R,
              left: nodeX - NODE_R,
              width: NODE_R * 2,
              height: NODE_R * 2,
              borderRadius: isMerge ? 3 : NODE_R,
              backgroundColor: commit.branchColor,
              zIndex: 3,
              borderWidth: commit.branches.includes(current) ? 2 : 0,
              borderColor: '#ffffff',
            }}
          />
        </View>

        {/* ── Commit info ── */}
        <View
          style={{
            flex: 1,
            paddingVertical: 10,
            paddingRight: 16,
            borderBottomWidth: isLast ? 0 : 1,
            borderBottomColor: '#21262d',
          }}
        >
          {/* Branch tags */}
          {commit.branches.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {commit.branches.map((br) => {
                const info = branchInfos.find((b) => b.name === br)
                const col = info?.color ?? '#58a6ff'
                const isCurrent = br === current
                return (
                  <View
                    key={br}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 20,
                      backgroundColor: col + '1a',
                      borderWidth: 1,
                      borderColor: col + '55',
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: col,
                        marginRight: 5,
                      }}
                    />
                    <Text style={{ color: col, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>
                      {br}
                    </Text>
                    {isCurrent && (
                      <View
                        style={{
                          marginLeft: 4,
                          backgroundColor: '#7ee787',
                          borderRadius: 4,
                          paddingHorizontal: 4,
                          paddingVertical: 1,
                        }}
                      >
                        <Text style={{ color: '#0d1117', fontSize: 8, fontWeight: '800' }}>HEAD</Text>
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          )}

          {/* Commit message */}
          <Text
            style={{
              color: '#e6edf3',
              fontSize: 13,
              fontWeight: '600',
              lineHeight: 19,
            }}
            numberOfLines={isExpanded ? undefined : 1}
          >
            {commit.message.split('\n')[0]}
          </Text>

          {/* Meta row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
            {/* Avatar */}
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: commit.branchColor + '33',
                borderWidth: 1,
                borderColor: commit.branchColor + '66',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: commit.branchColor, fontSize: 7, fontWeight: '800' }}>
                {initials(commit.author)}
              </Text>
            </View>

            <Text style={{ color: '#8b949e', fontSize: 11, fontWeight: '500' }}>
              {commit.author}
            </Text>

            <Text style={{ color: '#30363d', fontSize: 11 }}>·</Text>

            <Text style={{ color: '#58a6ff', fontSize: 11, fontFamily: 'monospace', fontWeight: '600' }}>
              {commit.shortOid}
            </Text>

            <Text style={{ color: '#30363d', fontSize: 11 }}>·</Text>

            <Text style={{ color: '#484f58', fontSize: 11 }}>
              {timeAgo(commit.timestamp)}
            </Text>

            {isMerge && (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  backgroundColor: '#d2a8ff18',
                  borderWidth: 1,
                  borderColor: '#d2a8ff44',
                }}
              >
                <Text style={{ color: '#d2a8ff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
                  MERGE
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {/* ── Expanded panel ── */}
      {isExpanded && (
        <View
          style={{
            marginLeft: graphWidth,
            marginRight: 12,
            marginBottom: 8,
            backgroundColor: '#0a0a0a',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#1a1a1a',
            padding: 16,
          }}
        >
          {/* Full hash */}
          <Text style={{ color: '#484f58', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>
            COMMIT HASH
          </Text>
          <TouchableOpacity
            onPress={() => {
              try { Clipboard.setString(commit.oid) } catch {}
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#111111',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 7,
              marginBottom: 14,
            }}
          >
            <Text style={{ color: '#58a6ff', fontSize: 12, fontFamily: 'monospace', flex: 1 }}>
              {commit.oid}
            </Text>
            <Text style={{ color: '#484f58', fontSize: 10, marginLeft: 6 }}>
              tap to copy
            </Text>
          </TouchableOpacity>

          {/* Full message */}
          {commit.message.includes('\n') && (
            <>
              <Text style={{ color: '#484f58', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>
                FULL MESSAGE
              </Text>
              <View style={{ backgroundColor: '#21262d', borderRadius: 8, padding: 10, marginBottom: 14 }}>
                <Text style={{ color: '#c9d1d9', fontSize: 12, lineHeight: 18 }}>
                  {commit.message}
                </Text>
              </View>
            </>
          )}

          {/* Author + Date */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
            <View style={{ flex: 1, backgroundColor: '#21262d', borderRadius: 8, padding: 10 }}>
              <Text style={{ color: '#484f58', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>
                AUTHOR
              </Text>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: commit.branchColor + '25',
                  borderWidth: 1.5,
                  borderColor: commit.branchColor + '66',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 6,
                }}
              >
                <Text style={{ color: commit.branchColor, fontSize: 10, fontWeight: '800' }}>
                  {initials(commit.author)}
                </Text>
              </View>
              <Text style={{ color: '#e6edf3', fontSize: 12, fontWeight: '600' }}>
                {commit.author}
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: '#21262d', borderRadius: 8, padding: 10 }}>
              <Text style={{ color: '#484f58', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>
                DATE
              </Text>
              <Text style={{ color: '#e6edf3', fontSize: 11, marginTop: 6 }}>
                {formatDate(commit.timestamp)}
              </Text>
              <Text style={{ color: '#484f58', fontSize: 11, marginTop: 2 }}>
                {timeAgo(commit.timestamp)}
              </Text>
            </View>
          </View>

          {/* Parents */}
          <Text style={{ color: '#484f58', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>
            PARENTS ({commit.parents.length})
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: commit.branches.length > 0 ? 14 : 0 }}>
            {commit.parents.length === 0 ? (
              <View style={{ backgroundColor: '#7ee787' + '18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#7ee787' + '44' }}>
                <Text style={{ color: '#7ee787', fontSize: 11, fontWeight: '600' }}>⬤ Initial commit</Text>
              </View>
            ) : commit.parents.map((p) => (
              <View
                key={p}
                style={{
                  backgroundColor: '#1f6feb18',
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: '#1f6feb44',
                }}
              >
                <Text style={{ color: '#58a6ff', fontSize: 11, fontFamily: 'monospace', fontWeight: '600' }}>
                  {p.slice(0, 7)}
                </Text>
              </View>
            ))}
          </View>

          {/* Branch tips */}
          {commit.branches.length > 0 && (
            <>
              <Text style={{ color: '#484f58', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>
                BRANCH TIPS
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {commit.branches.map((br) => {
                  const info = branchInfos.find((b) => b.name === br)
                  const col = info?.color ?? '#58a6ff'
                  return (
                    <View
                      key={br}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 20,
                        backgroundColor: col + '1a',
                        borderWidth: 1,
                        borderColor: col + '55',
                        gap: 5,
                      }}
                    >
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: col }} />
                      <Text style={{ color: col, fontSize: 11, fontWeight: '700' }}>{br}</Text>
                    </View>
                  )
                })}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  )
}

/* ═══════════════ MAIN SCREEN ═══════════════ */
export default function BranchGraphScreen() {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name: string }>()
  const { width: SCREEN_W } = Dimensions.get('window')

  const [loading, setLoading] = useState(true)
  const [graphCommits, setGraphCommits] = useState<GraphCommit[]>([])
  const [branchInfos, setBranchInfos] = useState<BranchInfo[]>([])
  const [activeBranch, setActiveBranch] = useState<string | null>(null)
  const [current, setCurrent] = useState('main')
  const [expandedOid, setExpandedOid] = useState<string | null>(null)
  const [maxColumns, setMaxColumns] = useState(1)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)

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

      const branchTips: { name: string; oid: string }[] = []
      for (const br of branches) {
        try {
          const oid = await resolveRef(name, br)
          branchTips.push({ name: br, oid })
        } catch {}
      }

      const allCommitsMap = new Map<string, GraphCommit>()
      const branchTipMap = new Map<string, string[]>()

      for (let i = 0; i < branchTips.length; i++) {
        const bt = branchTips[i]
        if (!branchTipMap.has(bt.oid)) branchTipMap.set(bt.oid, [])
        branchTipMap.get(bt.oid)!.push(bt.name)

        try {
          const log = await getLog(name, { depth: 50, ref: bt.name })
          for (const entry of log) {
            if (!allCommitsMap.has(entry.oid)) {
              allCommitsMap.set(entry.oid, {
                oid: entry.oid,
                shortOid: entry.oid.slice(0, 7),
                message: entry.commit?.message?.trim() ?? '',
                author: entry.commit?.author?.name ?? 'Unknown',
                email: entry.commit?.author?.email ?? '',
                timestamp: entry.commit?.author?.timestamp ?? 0,
                parents: entry.commit?.parent ?? [],
                branches: [],
                column: 0,
                branchColor: BRANCH_COLORS[i % BRANCH_COLORS.length],
              })
            }
          }
        } catch {}
      }

      for (const [oid, brNames] of branchTipMap.entries()) {
        const c = allCommitsMap.get(oid)
        if (c) c.branches = brNames
      }

      const sorted = Array.from(allCommitsMap.values()).sort(
        (a, b) => b.timestamp - a.timestamp,
      )

      const infos: BranchInfo[] = branchTips.map((bt, i) => ({
        name: bt.name,
        tipOid: bt.oid,
        color: BRANCH_COLORS[i % BRANCH_COLORS.length],
        column: i,
      }))

      const oidColumnMap = new Map<string, number>()
      const oidColorMap = new Map<string, string>()

      for (let i = 0; i < branchTips.length; i++) {
        try {
          const log = await getLog(name, { depth: 50, ref: branchTips[i].name })
          for (const entry of log) {
            if (!oidColumnMap.has(entry.oid)) {
              oidColumnMap.set(entry.oid, i)
              oidColorMap.set(entry.oid, BRANCH_COLORS[i % BRANCH_COLORS.length])
            }
          }
        } catch {}
      }

      for (const c of sorted) {
        c.column = oidColumnMap.get(c.oid) ?? 0
        c.branchColor = oidColorMap.get(c.oid) ?? BRANCH_COLORS[0]
      }

      setMaxColumns(branchTips.length || 1)
      setBranchInfos(infos)
      setGraphCommits(sorted)
    } catch {}
    finally { setLoading(false) }
  }, [name])

  useEffect(() => { loadGraph() }, [loadGraph])

  /* ─── derived ─── */
  const visibleCommits = useMemo(() => {
    let list = graphCommits
    if (activeBranch) {
      const info = branchInfos.find((b) => b.name === activeBranch)
      if (info) list = list.filter((c) => c.column === info.column)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.message.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.shortOid.startsWith(q),
      )
    }
    return list
  }, [graphCommits, activeBranch, branchInfos, search])

  const showAllColumns = !activeBranch && !search.trim()
  const mergeCount = graphCommits.filter((c) => c.parents.length > 1).length
  const uniqueAuthors = new Set(graphCommits.map((c) => c.author)).size

  if (!name) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#8b949e' }}>Invalid repository</Text>
      </View>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }}>

      {/* ── Header ── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: 16,
          paddingBottom: 14,
          paddingHorizontal: 16,
          backgroundColor: '#000000',
          borderBottomWidth: 1,
          borderBottomColor: '#111111',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4, marginRight: 8 }}>
          <Text style={{ color: '#58a6ff', fontSize: 24, fontWeight: '300', lineHeight: 28 }}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#e6edf3', fontSize: 17, fontWeight: '700' }}>Branch Graph</Text>
          <Text style={{ color: '#484f58', fontSize: 12, marginTop: 1 }}>{name}</Text>
        </View>
        <TouchableOpacity
          onPress={() => { setShowSearch((v) => !v); setSearch('') }}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: showSearch ? '#1f6feb' : '#0a0a0a',
            borderWidth: 1,
            borderColor: showSearch ? '#58a6ff' : '#30363d',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: showSearch ? '#fff' : '#8b949e', fontSize: 15 }}>
            {showSearch ? '✕' : '⌕'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Search bar ── */}
      {showSearch && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: '#0a0a0a',
            borderBottomWidth: 1,
            borderBottomColor: '#21262d',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#0a0a0a',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: search ? '#1f6feb' : '#30363d',
              paddingHorizontal: 12,
              height: 38,
            }}
          >
            <Text style={{ color: '#484f58', fontSize: 14, marginRight: 8 }}>⌕</Text>
            <TextInput
              style={{ flex: 1, color: '#e6edf3', fontSize: 13 }}
              value={search}
              onChangeText={setSearch}
              placeholder="Search message, author, hash…"
              placeholderTextColor="#484f58"
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Text style={{ color: '#484f58', fontSize: 13, marginLeft: 6 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── Branch filter chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ backgroundColor: '#000000', borderBottomWidth: 1, borderBottomColor: '#111111', flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' }}
      >
        <TouchableOpacity
          onPress={() => setActiveBranch(null)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderRadius: 20,
            backgroundColor: activeBranch === null ? '#1f6feb' : '#0a0a0a',
            borderWidth: 1,
            borderColor: activeBranch === null ? '#58a6ff' : '#222222',
          }}
        >
          <Text style={{ color: activeBranch === null ? '#fff' : '#8b949e', fontSize: 12, fontWeight: '700' }}>
            All
          </Text>
        </TouchableOpacity>

        {branchInfos.map((bi) => (
          <TouchableOpacity
            key={bi.name}
            onPress={() => setActiveBranch(activeBranch === bi.name ? null : bi.name)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              paddingVertical: 5,
              borderRadius: 20,
              backgroundColor: activeBranch === bi.name ? bi.color + '22' : '#0a0a0a',
              borderWidth: 1,
              borderColor: activeBranch === bi.name ? bi.color : '#222222',
              gap: 6,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: bi.color }} />
            <Text
              style={{
                color: activeBranch === bi.name ? bi.color : '#8b949e',
                fontSize: 12,
                fontWeight: activeBranch === bi.name ? '700' : '500',
              }}
            >
              {bi.name}
            </Text>
            {bi.name === current && (
              <View
                style={{
                  backgroundColor: '#7ee787',
                  borderRadius: 4,
                  paddingHorizontal: 4,
                  paddingVertical: 1,
                }}
              >
                <Text style={{ color: '#0d1117', fontSize: 8, fontWeight: '800' }}>HEAD</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Stats banner ── */}
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: '#000000',
          borderBottomWidth: 1,
          borderBottomColor: '#111111',
          gap: 20,
        }}
      >
        {[
          { label: 'Commits', value: visibleCommits.length, color: '#58a6ff' },
          { label: 'Branches', value: branchInfos.length, color: '#7ee787' },
          { label: 'Merges', value: mergeCount, color: '#d2a8ff' },
          { label: 'Authors', value: uniqueAuthors, color: '#ffa657' },
        ].map((stat) => (
          <View key={stat.label} style={{ alignItems: 'center' }}>
            <Text style={{ color: stat.color, fontSize: 16, fontWeight: '700' }}>{stat.value}</Text>
            <Text style={{ color: '#484f58', fontSize: 10, marginTop: 1 }}>{stat.label}</Text>
          </View>
        ))}
        {search ? (
          <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
            <Text style={{ color: '#f2cc60', fontSize: 11, fontWeight: '600' }}>
              {visibleCommits.length} result{visibleCommits.length !== 1 ? 's' : ''}
            </Text>
          </View>
        ) : activeBranch ? (
          <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
            <Text style={{ color: '#8b949e', fontSize: 11 }}>Showing {activeBranch}</Text>
          </View>
        ) : null}
      </View>

      {/* ── Commit list ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadGraph} tintColor="#58a6ff" />
        }
      >
        {loading ? (
          <View style={{ marginTop: 60, alignItems: 'center', gap: 16 }}>
            <ActivityIndicator color="#58a6ff" size="large" />
            <Text style={{ color: '#333333', fontSize: 13 }}>Building graph…</Text>
          </View>
        ) : visibleCommits.length === 0 ? (
          <View style={{ marginTop: 60, alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#484f58', fontSize: 28 }}>
              {search ? '🔍' : '🌿'}
            </Text>
            <Text style={{ color: '#8b949e', fontSize: 14, fontWeight: '600' }}>
              {search ? 'No commits match your search' : 'No commits found'}
            </Text>
            {search && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Text style={{ color: '#58a6ff', fontSize: 13, marginTop: 4 }}>Clear search</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ paddingTop: 4 }}>
            {visibleCommits.map((commit, idx) => (
              <CommitRow
                key={commit.oid}
                commit={commit}
                isExpanded={expandedOid === commit.oid}
                onToggle={() => setExpandedOid(expandedOid === commit.oid ? null : commit.oid)}
                maxColumns={maxColumns}
                branchInfos={branchInfos}
                activeBranch={activeBranch}
                current={current}
                isLast={idx === visibleCommits.length - 1}
                showAllColumns={showAllColumns}
              />
            ))}

            {/* Footer hint */}
            <View style={{ alignItems: 'center', paddingTop: 24, paddingBottom: 8 }}>
              <Text style={{ color: '#1a1a1a', fontSize: 11 }}>
                ─── end of history ───
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
