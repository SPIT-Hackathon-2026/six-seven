import React, { useCallback, useState, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from 'expo-router'
import {
  ArrowLeft,
  Users,
  GitCommit,
  TrendingUp,
  FileCode,
  GitBranch,
  Calendar,
  BarChart3,
  Clock,
  ChevronRight,
} from 'lucide-react-native'
import {
  getLog,
  diffSummary,
  listBranches,
  currentBranch as getCurrent,
  getRemoteDivergence,
} from '@/services/gitService'

/* ───── helpers ───── */

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#f0883e', '#79c0ff', '#56d364']

/* ───── types ───── */

interface CommitData {
  oid: string; message: string; author: string; email: string; timestamp: number; parents: string[]
}
interface AuthorStat {
  name: string; email: string; commits: number; firstCommit: number; lastCommit: number; color: string
}

/* ═══════════════════════════════════════════ */

export default function AnalyticsScreen() {
  const { name } = useLocalSearchParams<{ name: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [commits, setCommits] = useState<CommitData[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [activeBranch, setActiveBranch] = useState<string | null>(null)
  const [divergence, setDivergence] = useState<{ ahead: number; behind: number } | null>(null)
  const [topFiles, setTopFiles] = useState<{ path: string; changes: number }[]>([])

  const loadData = useCallback(async () => {
    if (!name) return
    setLoading(true)
    try {
      const [log, brList, curBr] = await Promise.all([
        getLog(name, { depth: 200 }),
        listBranches(name),
        getCurrent(name),
      ])

      const parsed: CommitData[] = (log || []).map((entry: any) => ({
        oid: entry.oid,
        message: (entry.commit?.message ?? entry.message ?? '').trim(),
        author: entry.commit?.author?.name ?? entry.author ?? 'Unknown',
        email: entry.commit?.author?.email ?? '',
        timestamp: ((entry.commit?.author?.timestamp ?? entry.timestamp ?? 0) > 1e12
          ? entry.commit?.author?.timestamp ?? entry.timestamp ?? 0
          : (entry.commit?.author?.timestamp ?? entry.timestamp ?? 0) * 1000),
        parents: entry.commit?.parent ?? [],
      }))

      setCommits(parsed)
      setBranches(brList || [])
      setActiveBranch(curBr ?? null)

      if (curBr) {
        const div = await getRemoteDivergence(name, curBr).catch(() => null)
        setDivergence(div)
      }

      // Code churn — top 10 most changed files
      const fileMap: Record<string, number> = {}
      for (const oid of parsed.slice(0, 30).map((c) => c.oid)) {
        try {
          const files = await diffSummary(name, oid)
          if (Array.isArray(files)) {
            for (const f of files) fileMap[f.filepath || ''] = (fileMap[f.filepath || ''] || 0) + 1
          }
        } catch { /* skip */ }
      }
      setTopFiles(
        Object.entries(fileMap).sort(([, a], [, b]) => b - a).slice(0, 10).map(([path, changes]) => ({ path, changes }))
      )
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [name])

  useFocusEffect(useCallback(() => { loadData() }, [loadData]))

  /* ───── computed ───── */

  const authorStats = useMemo((): AuthorStat[] => {
    const map: Record<string, AuthorStat> = {}
    commits.forEach((c) => {
      const key = c.author.toLowerCase()
      if (!map[key]) {
        map[key] = { name: c.author, email: c.email, commits: 0, firstCommit: c.timestamp, lastCommit: c.timestamp, color: COLORS[Object.keys(map).length % COLORS.length] }
      }
      map[key].commits++
      if (c.timestamp < map[key].firstCommit) map[key].firstCommit = c.timestamp
      if (c.timestamp > map[key].lastCommit) map[key].lastCommit = c.timestamp
    })
    return Object.values(map).sort((a, b) => b.commits - a.commits)
  }, [commits])

  const last7Days = useMemo(() => {
    const days: number[] = Array(7).fill(0)
    const now = Date.now()
    commits.forEach((c) => {
      const age = Math.floor((now - c.timestamp) / 86400000)
      if (age >= 0 && age < 7) days[6 - age]++
    })
    return days
  }, [commits])

  const maxWeekly = Math.max(...last7Days, 1)

  /* ═══════════════ RENDER ═══════════════ */

  return (
    <SafeAreaView className="flex-1 bg-neutral-100 dark:bg-black">
      <View className="pt-4 pb-3 px-5 bg-white dark:bg-zinc-900 border-b border-neutral-200 dark:border-zinc-800">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={() => router.back()} className="p-1">
            <ArrowLeft size={20} color="#8b949e" />
          </TouchableOpacity>
          <BarChart3 size={20} color="#58a6ff" />
          <Text className="text-black dark:text-white text-lg font-bold flex-1" numberOfLines={1}>
            Analytics — {name}
          </Text>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} tintColor="#58a6ff" />}
      >
        {loading && commits.length === 0 ? (
          <View className="mt-20 items-center">
            <ActivityIndicator size="large" color="#58a6ff" />
            <Text className="text-neutral-500 text-sm mt-3">Analyzing repository...</Text>
          </View>
        ) : (
          <>
            {/* Summary cards */}
            <View className="flex-row flex-wrap px-4 pt-4 gap-3">
              <StatCard icon={<GitCommit size={16} color="#58a6ff" />} label="Commits" value={`${commits.length}`} bg="bg-blue-50 dark:bg-blue-900/20" />
              <StatCard icon={<Users size={16} color="#3fb950" />} label="Contributors" value={`${authorStats.length}`} bg="bg-green-50 dark:bg-green-900/20" />
              <StatCard icon={<GitBranch size={16} color="#d29922" />} label="Branches" value={`${branches.length}`} bg="bg-amber-50 dark:bg-amber-900/20" />
              {divergence && (
                <StatCard icon={<TrendingUp size={16} color="#a371f7" />} label="Divergence" value={`↑${divergence.ahead} ↓${divergence.behind}`} bg="bg-purple-50 dark:bg-purple-900/20" />
              )}
            </View>

            {/* Weekly Activity */}
            <SectionHeader icon={<Calendar size={14} color="#58a6ff" />} title="This Week's Activity" />
            <View className="mx-5 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
              <View className="flex-row items-end justify-between" style={{ height: 80 }}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                  <View key={i} className="items-center flex-1">
                    <View style={{ width: 20, height: Math.max(4, (last7Days[i] / maxWeekly) * 60), backgroundColor: last7Days[i] > 0 ? '#58a6ff' : '#30363d', borderRadius: 4 }} />
                    <Text className="text-neutral-500 text-[10px] mt-1.5 font-medium">{day}</Text>
                    {last7Days[i] > 0 && <Text className="text-blue-400 text-[9px] font-bold">{last7Days[i]}</Text>}
                  </View>
                ))}
              </View>
            </View>

            {/* Contributors — tappable to view user profile */}
            <SectionHeader icon={<Users size={14} color="#3fb950" />} title="Contributors" />
            <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
              {authorStats.map((author, idx) => {
                const pct = commits.length > 0 ? (author.commits / commits.length) * 100 : 0
                return (
                  <TouchableOpacity
                    key={author.name}
                    className={`px-4 py-3 ${idx < authorStats.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                    onPress={() => router.push({
                      pathname: '/repo/[name]/user-profile' as any,
                      params: { name, author: author.name, email: author.email },
                    })}
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center gap-2.5 flex-1">
                        <View className="w-7 h-7 rounded-full items-center justify-center"
                          style={{ backgroundColor: author.color + '20', borderColor: author.color + '40', borderWidth: 1 }}>
                          <Text style={{ color: author.color, fontSize: 10, fontWeight: '800' }}>
                            {author.name.slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View className="flex-1">
                          <Text className="text-black dark:text-white text-sm font-semibold">{author.name}</Text>
                          <Text className="text-neutral-500 text-[10px]">{author.commits} commits · {timeAgo(author.lastCommit)}</Text>
                        </View>
                      </View>
                      <Text className="text-neutral-400 text-xs font-bold mr-2">{pct.toFixed(0)}%</Text>
                      <ChevronRight size={14} color="#8b949e" />
                    </View>
                    <View className="h-1.5 rounded-full bg-neutral-100 dark:bg-zinc-800 overflow-hidden">
                      <View style={{ width: `${pct}%`, backgroundColor: author.color, height: '100%', borderRadius: 4 }} />
                    </View>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* Heatmap */}
            <SectionHeader icon={<Clock size={14} color="#d29922" />} title="Activity Heatmap (4 weeks)" />
            <View className="mx-5 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
              <HeatmapGrid commits={commits} />
            </View>

            {/* Code Churn */}
            <SectionHeader icon={<FileCode size={14} color="#f85149" />} title="Most Changed Files" />
            <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
              {topFiles.length === 0 ? (
                <View className="py-6 items-center">
                  <Text className="text-neutral-500 text-xs">No file change data available</Text>
                </View>
              ) : topFiles.map((file, idx) => {
                const pct = (file.changes / topFiles[0].changes) * 100
                return (
                  <View key={file.path} className={`px-4 py-3 ${idx < topFiles.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}>
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-black dark:text-neutral-200 text-xs font-medium flex-1 mr-3" numberOfLines={1}>{file.path}</Text>
                      <Text className="text-orange-400 text-[11px] font-bold">{file.changes}×</Text>
                    </View>
                    <View className="h-1 rounded-full bg-neutral-100 dark:bg-zinc-800 overflow-hidden">
                      <View style={{ width: `${pct}%`, backgroundColor: '#f85149', height: '100%', borderRadius: 4 }} />
                    </View>
                  </View>
                )
              })}
            </View>

            {/* Branches */}
            <SectionHeader icon={<GitBranch size={14} color="#a371f7" />} title={`Branches (${branches.length})`} />
            <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
              {branches.map((br, idx) => (
                <View key={br} className={`flex-row items-center px-4 py-3 ${idx < branches.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}>
                  <GitBranch size={13} color={br === activeBranch ? '#3fb950' : '#8b949e'} />
                  <Text className={`ml-2.5 text-sm font-medium ${br === activeBranch ? 'text-green-500 font-bold' : 'text-neutral-600 dark:text-neutral-300'}`}>{br}</Text>
                  {br === activeBranch && (
                    <View className="ml-auto px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30">
                      <Text className="text-green-600 dark:text-green-400 text-[9px] font-bold">CURRENT</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
            <View className="h-8" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

/* ═══════ Sub-components ═══════ */

function StatCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string; bg: string }) {
  return (
    <View className={`flex-1 min-w-[140px] p-3.5 rounded-xl ${bg} border border-neutral-200/50 dark:border-zinc-800/50`}>
      <View className="flex-row items-center gap-2 mb-1">
        {icon}
        <Text className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider">{label}</Text>
      </View>
      <Text className="text-black dark:text-white text-xl font-bold">{value}</Text>
    </View>
  )
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View className="flex-row items-center gap-2 px-5 mt-5 mb-2.5">
      {icon}
      <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider">{title}</Text>
    </View>
  )
}

function HeatmapGrid({ commits }: { commits: CommitData[] }) {
  const cells = useMemo(() => {
    const map: Record<string, number> = {}
    commits.forEach((c) => {
      const d = new Date(c.timestamp).toISOString().split('T')[0]
      map[d] = (map[d] || 0) + 1
    })
    const grid: { date: string; count: number }[] = []
    const now = new Date()
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i)
      const key = d.toISOString().split('T')[0]
      grid.push({ date: key, count: map[key] || 0 })
    }
    return grid
  }, [commits])

  const maxCount = Math.max(...cells.map((c) => c.count), 1)

  return (
    <View className="flex-row flex-wrap gap-1.5 justify-center">
      {cells.map((cell) => {
        const intensity = cell.count / maxCount
        const bg = cell.count === 0 ? '#161b22' : intensity < 0.25 ? '#0e4429' : intensity < 0.5 ? '#006d32' : intensity < 0.75 ? '#26a641' : '#39d353'
        return (
          <View key={cell.date} style={{ width: 28, height: 28, backgroundColor: bg, borderRadius: 4, alignItems: 'center', justifyContent: 'center' }}>
            {cell.count > 0 && <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700' }}>{cell.count}</Text>}
          </View>
        )
      })}
    </View>
  )
}
