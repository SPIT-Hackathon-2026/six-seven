import { useCallback, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'

import { currentBranch, getStatus, initRepo } from '@/services/gitService'
import { getRepoSize, listRepos } from '@/services/repoService'

type RepoCard = {
  name: string
  branch: string
  statusText: 'Modified' | 'Clean'
  statusColor: string
  sizeText: string
  ageText: string
}

function formatBytes(bytes: number) {
  if (!bytes) return '0B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value % 1 === 0 ? value : value.toFixed(1)}${units[idx]}`
}

function formatAge(dateMs?: number) {
  if (!dateMs) return 'just now'
  const diff = Date.now() - dateMs
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export default function HomeScreen() {
  const router = useRouter()
  const [repos, setRepos] = useState<RepoCard[]>([])
  const [loading, setLoading] = useState(false)

  const refreshRepos = useCallback(async () => {
    setLoading(true)
    try {
      const basicRepos = await listRepos()
      const cards: RepoCard[] = await Promise.all(
        basicRepos.map(async (repo) => {
          const [branch, statuses, size] = await Promise.all([
            repo.isGitRepo ? currentBranch(repo.name).catch(() => null) : null,
            repo.isGitRepo ? getStatus(repo.name).catch(() => []) : [],
            getRepoSize(repo.name).catch(() => 0),
          ])

          const isModified = statuses.some((item) => item.status !== 'unmodified')

          return {
            name: repo.name,
            branch: branch ?? 'main',
            statusText: isModified ? 'Modified' : 'Clean',
            statusColor: isModified ? '#7ee787' : '#7ee787',
            sizeText: formatBytes(size),
            ageText: formatAge(),
          }
        }),
      )
      setRepos(cards)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      refreshRepos()
    }, [refreshRepos]),
  )

  const repoCountLabel = useMemo(
    () => `${repos.length} repo${repos.length === 1 ? '' : 's'}`,
    [repos.length],
  )

  const handleInit = useCallback(async () => {
    const repoName = `Repo-${Date.now().toString().slice(-5)}`
    try {
      await initRepo(repoName)
      await refreshRepos()
    } catch (err: any) {
      Alert.alert('Init failed', err?.message ?? 'Could not initialize repo.')
    }
  }, [refreshRepos])

  return (
    <View className="flex-1 bg-[#050b16]">
      <View className="px-5 pt-6 pb-4 border-b border-[#161b22] flex-row items-center justify-between">
        <Text className="text-[#f0f6fc] text-5xl font-extrabold">GitLane</Text>
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            className="w-9 h-9 rounded-full border border-[#30363d] items-center justify-center"
            onPress={() => router.push('/testing')}
          >
            <Text className="text-[#c9d1d9] text-lg">🧪</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="w-9 h-9 rounded-full border border-[#30363d] items-center justify-center"
            onPress={() => router.push('/settings')}
          >
            <Text className="text-[#c9d1d9] text-lg">⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View className="px-5 pt-4 flex-row gap-3">
        <TouchableOpacity
          className="flex-1 py-3 rounded-xl bg-[#1f6feb] items-center"
          onPress={() => Alert.alert('Clone', 'Clone flow can be added next.')}
        >
          <Text className="text-[#f0f6fc] text-lg font-bold">+ Clone</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 py-3 rounded-xl bg-[#21262d] items-center"
          onPress={handleInit}
        >
          <Text className="text-[#f0f6fc] text-lg font-bold">+ Init</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 py-3 rounded-xl bg-[#21262d] items-center"
          onPress={() => router.push('/transfer')}
        >
          <Text className="text-[#f0f6fc] text-lg font-bold">Import</Text>
        </TouchableOpacity>
      </View>

      <Text className="px-5 pt-3 text-[#8b949e] text-xs uppercase tracking-wider">
        Repositories · {repoCountLabel}
      </Text>

      <ScrollView className="flex-1 px-5 pt-2" contentContainerStyle={{ paddingBottom: 120 }}>
        {loading && repos.length === 0 ? (
          <View className="mt-3 rounded-2xl border border-[#30363d] bg-[#111827] p-4">
            <Text className="text-[#8b949e]">Loading repositories…</Text>
          </View>
        ) : repos.length === 0 ? (
          <View className="mt-3 rounded-2xl border border-[#30363d] bg-[#111827] p-4">
            <Text className="text-[#e6edf3] text-base font-semibold">No repositories yet</Text>
            <Text className="text-[#8b949e] mt-1">Use + Init or Import to get started.</Text>
          </View>
        ) : (
          repos.map((repo) => (
            <TouchableOpacity
              key={repo.name}
              className="mt-3 rounded-2xl border border-[#30363d] bg-[#111827] p-4 active:bg-[#1c2333]"
              onPress={() => router.push({
                pathname: '/repo/[name]',
                params: { name: repo.name }
              } as any)}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <Text className="text-[#c9d1d9] text-lg">📁</Text>
                  <Text className="text-[#f0f6fc] text-[28px] font-extrabold">{repo.name}</Text>
                </View>
                <Text className="text-[#8b949e] text-xl">›</Text>
              </View>

              <Text className="text-[#c9d1d9] text-2xl mt-2 font-semibold">Branch: {repo.branch}</Text>

              <View className="flex-row items-center mt-2">
                <Text style={{ color: repo.statusColor }} className="text-2xl font-semibold">
                  {repo.statusText}
                </Text>
                <Text className="text-[#8b949e] text-2xl"> · {repo.sizeText} · {repo.ageText}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  )
}
