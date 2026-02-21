import React, { useCallback, useState, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from 'expo-router'
import {
  ArrowLeft,
  GitCommit,
  Calendar,
  Clock,
  FileCode,
  TrendingUp,
  Award,
  Flame,
  Code2,
  User,
} from 'lucide-react-native'
import { getLog, diffSummary } from '@/services/gitService'

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

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const HOUR_LABELS = ['12a','','','3a','','','6a','','','9a','','','12p','','','3p','','','6p','','','9p','','']

/* ═══════════════════════════════════════════ */

export default function UserProfileScreen() {
  const { name, author, email } = useLocalSearchParams<{ name: string; author: string; email: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [userCommits, setUserCommits] = useState<any[]>([])
  const [totalRepoCommits, setTotalRepoCommits] = useState(0)
  const [topFiles, setTopFiles] = useState<{ path: string; changes: number }[]>([])

  const loadData = useCallback(async () => {
    if (!name || !author) return
    setLoading(true)
    try {
      const log = await getLog(name, { depth: 500 })
      if (!log) { setLoading(false); return }

      setTotalRepoCommits(log.length)

      const authorLower = author.toLowerCase()
      const filtered = log
        .map((entry: any) => ({
          oid: entry.oid,
          message: (entry.commit?.message ?? entry.message ?? '').trim(),
          author: entry.commit?.author?.name ?? entry.author ?? 'Unknown',
          email: entry.commit?.author?.email ?? '',
          timestamp: ((entry.commit?.author?.timestamp ?? entry.timestamp ?? 0) > 1e12
            ? entry.commit?.author?.timestamp ?? entry.timestamp ?? 0
            : (entry.commit?.author?.timestamp ?? entry.timestamp ?? 0) * 1000),
        }))
        .filter((c: any) => c.author.toLowerCase() === authorLower || c.email.toLowerCase() === authorLower)

      setUserCommits(filtered)

      // Files this user changed most
      const fileMap: Record<string, number> = {}
      for (const c of filtered.slice(0, 40)) {
        try {
          const files = await diffSummary(name, c.oid)
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
  }, [name, author])

  useFocusEffect(useCallback(() => { loadData() }, [loadData]))

  /* ───── computed ───── */

  const contribution = totalRepoCommits > 0 ? ((userCommits.length / totalRepoCommits) * 100).toFixed(1) : '0'
  const firstCommit = userCommits.length > 0 ? userCommits[userCommits.length - 1].timestamp : 0
  const lastCommit = userCommits.length > 0 ? userCommits[0].timestamp : 0

  // Streak calculation (consecutive days with commits)
  const { currentStreak, longestStreak } = useMemo(() => {
    const daySet = new Set<string>()
    userCommits.forEach((c) => {
      daySet.add(new Date(c.timestamp).toISOString().split('T')[0])
    })
    const days = [...daySet].sort().reverse()
    let current = 0, longest = 0, streak = 0
    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

    // Current streak
    for (let i = 0; i < days.length; i++) {
      const d = days[i]
      if (i === 0 && d !== today && d !== yesterday) break
      const expected = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
      if (d === expected) current++
      else break
    }

    // Longest streak
    let tempStreak = 1
    const sorted = [...daySet].sort()
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1])
      const curr = new Date(sorted[i])
      const diff = (curr.getTime() - prev.getTime()) / 86400000
      if (diff === 1) { tempStreak++; longest = Math.max(longest, tempStreak) }
      else tempStreak = 1
    }
    longest = Math.max(longest, tempStreak)
    if (sorted.length <= 1) longest = sorted.length

    return { currentStreak: current, longestStreak: longest }
  }, [userCommits])

  // Activity by hour of day
  const hourActivity = useMemo(() => {
    const hours = Array(24).fill(0)
    userCommits.forEach((c) => {
      const h = new Date(c.timestamp).getHours()
      hours[h]++
    })
    return hours
  }, [userCommits])
  const maxHour = Math.max(...hourActivity, 1)

  // Commits per day of week
  const dayActivity = useMemo(() => {
    const days = Array(7).fill(0)
    userCommits.forEach((c) => {
      days[new Date(c.timestamp).getDay()]++
    })
    return days
  }, [userCommits])
  const maxDayActivity = Math.max(...dayActivity, 1)

  // Last 28 days heatmap
  const heatmapCells = useMemo(() => {
    const map: Record<string, number> = {}
    userCommits.forEach((c) => {
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
  }, [userCommits])
  const maxHeat = Math.max(...heatmapCells.map((c) => c.count), 1)

  // Commit types breakdown
  const commitTypes = useMemo(() => {
    const types: Record<string, number> = { feat: 0, fix: 0, refactor: 0, docs: 0, chore: 0, other: 0 }
    userCommits.forEach((c) => {
      const msg = c.message.toLowerCase()
      if (/\b(feat|feature|add|new|implement)\b/.test(msg)) types.feat++
      else if (/\b(fix|bug|hotfix|patch|resolve)\b/.test(msg)) types.fix++
      else if (/\b(refactor|cleanup|restructure|rename)\b/.test(msg)) types.refactor++
      else if (/\b(doc|readme|comment)\b/.test(msg)) types.docs++
      else if (/\b(chore|merge|bump|version|deps)\b/.test(msg)) types.chore++
      else types.other++
    })
    return Object.entries(types).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)
  }, [userCommits])

  const typeColors: Record<string, string> = {
    feat: '#3fb950', fix: '#f85149', refactor: '#a371f7', docs: '#58a6ff', chore: '#8b949e', other: '#6e7681'
  }
  const typeEmojis: Record<string, string> = {
    feat: '✨', fix: '🐛', refactor: '♻️', docs: '📄', chore: '🔧', other: '💬'
  }

  /* ═══════════════ RENDER ═══════════════ */

  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black">
      {/* Header */}
      <View className="pt-14 pb-5 px-5 bg-white dark:bg-zinc-900 border-b border-neutral-200 dark:border-zinc-800">
        <TouchableOpacity onPress={() => router.back()} className="flex-row items-center gap-2 mb-4">
          <ArrowLeft size={18} color="#8b949e" />
          <Text className="text-neutral-500 text-sm">Back to Analytics</Text>
        </TouchableOpacity>

        <View className="flex-row items-center gap-4">
          <View className="w-14 h-14 rounded-full items-center justify-center bg-blue-100 dark:bg-blue-900/30 border-2 border-blue-300 dark:border-blue-700">
            <Text className="text-blue-600 dark:text-blue-400 text-lg font-black">
              {(author || '??').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-black dark:text-white text-xl font-bold">{author}</Text>
            {email ? <Text className="text-neutral-500 text-xs mt-0.5">{email}</Text> : null}
            <Text className="text-neutral-400 text-[10px] mt-1">
              {userCommits.length} commits in {name}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} tintColor="#58a6ff" />}
      >
        {loading ? (
          <View className="mt-20 items-center">
            <ActivityIndicator size="large" color="#58a6ff" />
            <Text className="text-neutral-500 text-sm mt-3">Loading profile...</Text>
          </View>
        ) : (
          <>
            {/* Stats row */}
            <View className="flex-row flex-wrap px-4 pt-4 gap-3">
              <MiniStat icon={<GitCommit size={14} color="#58a6ff" />} label="Commits" value={`${userCommits.length}`} />
              <MiniStat icon={<TrendingUp size={14} color="#3fb950" />} label="Contribution" value={`${contribution}%`} />
              <MiniStat icon={<Flame size={14} color="#f0883e" />} label="Streak" value={`${currentStreak}d`} />
              <MiniStat icon={<Award size={14} color="#d29922" />} label="Best Streak" value={`${longestStreak}d`} />
            </View>

            {/* Timeline info */}
            <View className="mx-5 mt-3 flex-row gap-3">
              <View className="flex-1 p-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
                <Text className="text-neutral-500 text-[9px] font-bold uppercase">First commit</Text>
                <Text className="text-black dark:text-white text-xs font-semibold mt-1">{firstCommit > 0 ? formatDate(firstCommit) : '—'}</Text>
              </View>
              <View className="flex-1 p-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
                <Text className="text-neutral-500 text-[9px] font-bold uppercase">Latest commit</Text>
                <Text className="text-black dark:text-white text-xs font-semibold mt-1">{lastCommit > 0 ? timeAgo(lastCommit) : '—'}</Text>
              </View>
            </View>

            {/* Activity Heatmap */}
            <SecH icon={<Calendar size={14} color="#58a6ff" />} title="Activity (4 Weeks)" />
            <View className="mx-5 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
              <View className="flex-row flex-wrap gap-1.5 justify-center">
                {heatmapCells.map((cell) => {
                  const intensity = cell.count / maxHeat
                  const bg = cell.count === 0 ? '#161b22' : intensity < 0.25 ? '#0e4429' : intensity < 0.5 ? '#006d32' : intensity < 0.75 ? '#26a641' : '#39d353'
                  return (
                    <View key={cell.date} style={{ width: 28, height: 28, backgroundColor: bg, borderRadius: 4, alignItems: 'center', justifyContent: 'center' }}>
                      {cell.count > 0 && <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700' }}>{cell.count}</Text>}
                    </View>
                  )
                })}
              </View>
            </View>

            {/* Commit Time Distribution */}
            <SecH icon={<Clock size={14} color="#a371f7" />} title="Active Hours" />
            <View className="mx-5 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
              <View className="flex-row items-end justify-between" style={{ height: 50 }}>
                {hourActivity.map((count, i) => (
                  <View key={i} className="items-center" style={{ flex: 1 }}>
                    <View style={{
                      width: 6, height: Math.max(2, (count / maxHour) * 40),
                      backgroundColor: count > 0 ? '#a371f7' : '#21262d', borderRadius: 2,
                    }} />
                  </View>
                ))}
              </View>
              <View className="flex-row justify-between mt-1.5">
                {[0, 6, 12, 18].map((h) => (
                  <Text key={h} className="text-neutral-500 text-[8px]">{['12AM', '6AM', '12PM', '6PM'][h / 6]}</Text>
                ))}
              </View>
            </View>

            {/* Day of Week */}
            <SecH icon={<Calendar size={14} color="#d29922" />} title="Most Active Days" />
            <View className="mx-5 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
              <View className="flex-row items-end justify-between" style={{ height: 50 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                  <View key={i} className="items-center flex-1">
                    <View style={{
                      width: 18, height: Math.max(4, (dayActivity[i] / maxDayActivity) * 40),
                      backgroundColor: dayActivity[i] > 0 ? '#d29922' : '#21262d', borderRadius: 3,
                    }} />
                    <Text className="text-neutral-500 text-[8px] mt-1 font-medium">{day}</Text>
                    {dayActivity[i] > 0 && <Text className="text-amber-400 text-[7px] font-bold">{dayActivity[i]}</Text>}
                  </View>
                ))}
              </View>
            </View>

            {/* Commit Types */}
            <SecH icon={<Code2 size={14} color="#3fb950" />} title="Commit Types" />
            <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
              {commitTypes.map(([type, count], idx) => {
                const pct = userCommits.length > 0 ? (count / userCommits.length) * 100 : 0
                return (
                  <View key={type} className={`px-4 py-3 ${idx < commitTypes.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}>
                    <View className="flex-row items-center justify-between mb-1.5">
                      <View className="flex-row items-center gap-2">
                        <Text style={{ fontSize: 12 }}>{typeEmojis[type] || '💬'}</Text>
                        <Text className="text-black dark:text-white text-sm font-medium capitalize">{type}</Text>
                      </View>
                      <Text className="text-neutral-400 text-xs font-bold">{count} ({pct.toFixed(0)}%)</Text>
                    </View>
                    <View className="h-1.5 rounded-full bg-neutral-100 dark:bg-zinc-800 overflow-hidden">
                      <View style={{ width: `${pct}%`, backgroundColor: typeColors[type] || '#8b949e', height: '100%', borderRadius: 4 }} />
                    </View>
                  </View>
                )
              })}
            </View>

            {/* Files touched most */}
            <SecH icon={<FileCode size={14} color="#f85149" />} title="Most Modified Files" />
            <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
              {topFiles.length === 0 ? (
                <View className="py-6 items-center">
                  <Text className="text-neutral-500 text-xs">No data</Text>
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

            {/* Recent commits */}
            <SecH icon={<GitCommit size={14} color="#8b949e" />} title={`Recent Commits (${Math.min(15, userCommits.length)})`} />
            <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
              {userCommits.slice(0, 15).map((c, idx) => (
                <View key={c.oid} className={`px-4 py-3 ${idx < Math.min(14, userCommits.length - 1) ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}>
                  <Text className="text-black dark:text-white text-xs font-medium" numberOfLines={2}>{c.message}</Text>
                  <View className="flex-row items-center gap-2 mt-1.5">
                    <Text className="text-neutral-500 text-[10px] font-mono">{c.oid.slice(0, 7)}</Text>
                    <Text className="text-neutral-400 text-[10px]">·</Text>
                    <Text className="text-neutral-500 text-[10px]">{timeAgo(c.timestamp)}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View className="h-8" />
          </>
        )}
      </ScrollView>
    </View>
  )
}

/* ═══════ Sub-components ═══════ */

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View className="flex-1 min-w-[75px] p-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center">
      {icon}
      <Text className="text-black dark:text-white text-lg font-bold mt-1">{value}</Text>
      <Text className="text-neutral-500 text-[9px] font-bold uppercase tracking-wider">{label}</Text>
    </View>
  )
}

function SecH({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View className="flex-row items-center gap-2 px-5 mt-5 mb-2.5">
      {icon}
      <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider">{title}</Text>
    </View>
  )
}
