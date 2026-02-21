import { useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Upload, FlaskConical, Settings, Plus, Download, FolderGit2, Folder as FolderClosed, ChevronRight } from 'lucide-react-native'

import {
  currentBranch,
  getStatus,
  initRepo,
  duplicateRepo,
} from '@/services/gitService'
import {
  getRepoSize,
  listRepos,
  deleteRepo,
  renameRepo,
} from '@/services/repoService'

type RepoCard = {
  name: string
  branch: string
  statusText: 'Modified' | 'Clean'
  statusColor: string
  sizeText: string
  ageText: string
  isGitRepo: boolean
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
  const [showInitDialog, setShowInitDialog] = useState(false)
  const [initName, setInitName] = useState('')
  const [showDupDialog, setShowDupDialog] = useState<string | null>(null)
  const [dupName, setDupName] = useState('')

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

          const isModified = statuses.some(
            (item: any) => item.status !== 'unmodified',
          )

          return {
            name: repo.name,
            branch: branch ?? 'main',
            statusText: isModified ? 'Modified' : 'Clean',
            statusColor: isModified ? '#d29922' : '#7ee787',
            sizeText: formatBytes(size),
            ageText: formatAge(),
            isGitRepo: repo.isGitRepo,
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
    const repoName =
      initName.trim() || `Repo-${Date.now().toString().slice(-5)}`
    try {
      await initRepo(repoName)
      setShowInitDialog(false)
      setInitName('')
      await refreshRepos()
    } catch (err: any) {
      Alert.alert('Init failed', err?.message ?? 'Could not initialize repo.')
    }
  }, [initName, refreshRepos])

  const handleDelete = useCallback(
    (repoName: string) => {
      Alert.alert('Delete Repository', `Permanently delete "${repoName}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteRepo(repoName)
              await refreshRepos()
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Delete failed')
            }
          },
        },
      ])
    },
    [refreshRepos],
  )

  const handleDuplicate = useCallback(async () => {
    if (!showDupDialog) return
    const newName = dupName.trim() || `${showDupDialog}-copy`
    try {
      await duplicateRepo(showDupDialog, newName)
      setShowDupDialog(null)
      setDupName('')
      Alert.alert('Duplicated', `"${showDupDialog}" → "${newName}"`)
      await refreshRepos()
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Duplicate failed')
    }
  }, [showDupDialog, dupName, refreshRepos])

  const showRepoActions = useCallback(
    (repoName: string) => {
      Alert.alert(repoName, 'Choose an action', [
        {
          text: 'Open',
          onPress: () =>
            router.push({
              pathname: '/repo/[name]',
              params: { name: repoName },
            } as any),
        },
        {
          text: 'Duplicate',
          onPress: () => {
            setShowDupDialog(repoName)
            setDupName(`${repoName}-copy`)
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handleDelete(repoName),
        },
        { text: 'Cancel', style: 'cancel' },
      ])
    },
    [router, handleDelete],
  )

  return (
    <View className="flex-1 bg-[#050b16]">
      <View className="px-5 pt-6 pb-4 border-b border-[#161b22] flex-row items-center justify-between">
        <Text className="text-[#f0f6fc] text-5xl font-extrabold">GitLane</Text>
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-[#161b22] border border-[#30363d] items-center justify-center"
            onPress={() => router.push('/transfer')}
          >
            <Upload size={18} color="#c9d1d9" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-[#161b22] border border-[#30363d] items-center justify-center"
            onPress={() => router.push('/testing')}
          >
            <FlaskConical size={18} color="#c9d1d9" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-[#161b22] border border-[#30363d] items-center justify-center"
            onPress={() => router.push('/settings')}
          >
            <Settings size={18} color="#c9d1d9" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      </View>

      <View className="px-5 pt-4 flex-row gap-3">
        <TouchableOpacity
          className="flex-1 py-3.5 rounded-xl bg-[#21262d] flex-row justify-center gap-2 items-center"
          onPress={() => {
            setShowInitDialog(true)
            setInitName('')
          }}
        >
          <Plus size={20} color="#f0f6fc" />
          <Text className="text-[#f0f6fc] text-base font-bold">Init</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 py-3.5 rounded-xl bg-[#21262d] flex-row justify-center gap-2 items-center"
          onPress={() => router.push('/transfer')}
        >
          <Download size={20} color="#f0f6fc" />
          <Text className="text-[#f0f6fc] text-base font-bold">Import</Text>
        </TouchableOpacity>
      </View>

      {/* Init repo dialog */}
      {showInitDialog && (
        <View className="mx-5 mt-3 rounded-xl bg-[#161b22] border border-[#30363d] p-4">
          <Text className="text-[#e6edf3] text-sm font-semibold mb-2">
            New Repository
          </Text>
          <TextInput
            className="bg-[#0d1117] text-[#e6edf3] px-3 py-2 rounded-md border border-[#30363d] text-sm"
            value={initName}
            onChangeText={setInitName}
            placeholder="repository-name"
            placeholderTextColor="#484f58"
            autoFocus
          />
          <View className="flex-row gap-2 mt-3">
            <TouchableOpacity
              className="flex-1 py-2 rounded-md bg-[#1f6feb] items-center"
              onPress={handleInit}
            >
              <Text className="text-white text-sm font-semibold">Create</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="py-2 px-4 rounded-md bg-[#21262d] items-center"
              onPress={() => setShowInitDialog(false)}
            >
              <Text className="text-[#c9d1d9] text-sm">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Duplicate dialog */}
      {showDupDialog && (
        <View className="mx-5 mt-3 rounded-xl bg-[#161b22] border border-[#30363d] p-4">
          <Text className="text-[#e6edf3] text-sm font-semibold mb-2">
            Duplicate "{showDupDialog}"
          </Text>
          <TextInput
            className="bg-[#0d1117] text-[#e6edf3] px-3 py-2 rounded-md border border-[#30363d] text-sm"
            value={dupName}
            onChangeText={setDupName}
            placeholder="new-repo-name"
            placeholderTextColor="#484f58"
            autoFocus
          />
          <View className="flex-row gap-2 mt-3">
            <TouchableOpacity
              className="flex-1 py-2 rounded-md bg-[#1f6feb] items-center"
              onPress={handleDuplicate}
            >
              <Text className="text-white text-sm font-semibold">
                Duplicate
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="py-2 px-4 rounded-md bg-[#21262d] items-center"
              onPress={() => setShowDupDialog(null)}
            >
              <Text className="text-[#c9d1d9] text-sm">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text className="px-5 pt-3 text-[#8b949e] text-xs uppercase tracking-wider">
        Repositories · {repoCountLabel}
      </Text>

      <ScrollView
        className="flex-1 px-5 pt-2"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refreshRepos}
            tintColor="#58a6ff"
          />
        }
      >
        {loading && repos.length === 0 ? (
          <View className="mt-3 rounded-2xl border border-[#30363d] bg-[#111827] p-4">
            <Text className="text-[#8b949e]">Loading repositories…</Text>
          </View>
        ) : repos.length === 0 ? (
          <View className="mt-3 rounded-2xl border border-[#30363d] bg-[#111827] p-4">
            <Text className="text-[#e6edf3] text-base font-semibold">
              No repositories yet
            </Text>
            <Text className="text-[#8b949e] mt-1">
              Use + Init or Import to get started.
            </Text>
          </View>
        ) : (
          repos.map((repo) => (
            <TouchableOpacity
              key={repo.name}
              className="mt-3 rounded-2xl border border-[#30363d] bg-[#111827] p-4 active:bg-[#1c2333]"
              onPress={() =>
                router.push({
                  pathname: '/repo/[name]',
                  params: { name: repo.name },
                } as any)
              }
              onLongPress={() => showRepoActions(repo.name)}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-lg bg-[#21262d] items-center justify-center">
                    {repo.isGitRepo ? (
                      <FolderGit2 size={24} color="#58a6ff" />
                    ) : (
                      <FolderClosed size={24} color="#8b949e" />
                    )}
                  </View>
                  <Text className="text-[#f0f6fc] text-2xl font-bold">
                    {repo.name}
                  </Text>
                </View>
                <ChevronRight size={24} color="#8b949e" />
              </View>

              <Text className="text-[#c9d1d9] text-sm mt-3 font-semibold">
                Branch: <Text className="text-[#f0f6fc] font-bold">{repo.branch}</Text>
              </Text>

              <View className="flex-row items-center mt-2 border-t border-[#21262d] pt-3">
                <Text
                  style={{ color: repo.statusColor }}
                  className="text-sm font-semibold mr-2"
                >
                  ● {repo.statusText}
                </Text>
                <Text className="text-[#8b949e] text-sm">
                  · {repo.sizeText} · {repo.ageText}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  )
}
