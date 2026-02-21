import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
} from 'react-native'

import { getAuthor, setAuthor } from '@/services/gitService'
import { getFreeDiskSpace, REPO_BASE_PATH } from '@/utils/path'
import { listRepos, deleteRepo } from '@/services/repoService'

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[idx]}`
}

export default function SettingsScreen() {
  const [authorName, setAuthorName] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')
  const [saved, setSaved] = useState(false)
  const [diskSpace, setDiskSpace] = useState<string>('...')
  const [repoCount, setRepoCount] = useState(0)
  const [repoBasePath, setRepoBasePath] = useState('')

  useEffect(() => {
    const { name, email } = getAuthor()
    setAuthorName(name)
    setAuthorEmail(email)
    setRepoBasePath(REPO_BASE_PATH)
    ;(async () => {
      try {
        const free = await getFreeDiskSpace()
        setDiskSpace(formatBytes(free))
      } catch {
        setDiskSpace('N/A')
      }
      try {
        const repos = await listRepos()
        setRepoCount(repos.length)
      } catch {
        setRepoCount(0)
      }
    })()
  }, [])

  const handleSaveAuthor = useCallback(() => {
    if (!authorName.trim()) {
      Alert.alert('Error', 'Author name is required')
      return
    }
    setAuthor(authorName.trim(), authorEmail.trim() || 'user@example.com')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [authorName, authorEmail])

  const handleDeleteAll = useCallback(async () => {
    Alert.alert('Delete All Repos', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          try {
            const repos = await listRepos()
            for (const repo of repos) {
              await deleteRepo(repo.name)
            }
            setRepoCount(0)
            Alert.alert('Done', 'All repositories deleted')
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Failed to delete repos')
          }
        },
      },
    ])
  }, [])

  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="px-5 py-4 border-b border-[#30363d]">
        <Text className="text-[#e6edf3] text-lg font-bold">Settings</Text>
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 160 }}
      >
        {/* Git Author */}
        <View className="mt-5">
          <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-3">
            Git Author
          </Text>
          <View className="rounded-lg bg-[#161b22] border border-[#30363d] p-4">
            <Text className="text-[#c9d1d9] text-sm mb-1.5">Name</Text>
            <TextInput
              className="bg-[#0d1117] text-[#e6edf3] px-3 py-2 rounded-md border border-[#30363d] text-sm"
              value={authorName}
              onChangeText={setAuthorName}
              placeholder="Your Name"
              placeholderTextColor="#484f58"
            />
            <Text className="text-[#c9d1d9] text-sm mb-1.5 mt-3">Email</Text>
            <TextInput
              className="bg-[#0d1117] text-[#e6edf3] px-3 py-2 rounded-md border border-[#30363d] text-sm"
              value={authorEmail}
              onChangeText={setAuthorEmail}
              placeholder="user@example.com"
              placeholderTextColor="#484f58"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity
              className="mt-3 py-2 rounded-md bg-[#1f6feb] items-center"
              onPress={handleSaveAuthor}
            >
              <Text className="text-white text-sm font-semibold">
                {saved ? '✓ Saved' : 'Save Author'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Storage Info */}
        <View className="mt-6">
          <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-3">
            Storage
          </Text>
          <View className="rounded-lg bg-[#161b22] border border-[#30363d] p-4">
            <View className="flex-row justify-between py-1.5">
              <Text className="text-[#8b949e] text-sm">Free disk space</Text>
              <Text className="text-[#e6edf3] text-sm font-semibold">
                {diskSpace}
              </Text>
            </View>
            <View className="flex-row justify-between py-1.5">
              <Text className="text-[#8b949e] text-sm">Repositories</Text>
              <Text className="text-[#e6edf3] text-sm font-semibold">
                {repoCount}
              </Text>
            </View>
            <View className="py-1.5">
              <Text className="text-[#8b949e] text-sm">Data path</Text>
              <Text className="text-[#484f58] text-xs mt-0.5" numberOfLines={2}>
                {repoBasePath}
              </Text>
            </View>
          </View>
        </View>

        {/* About */}
        <View className="mt-6">
          <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-3">
            About
          </Text>
          <View className="rounded-lg bg-[#161b22] border border-[#30363d] p-4">
            <View className="flex-row justify-between py-1.5">
              <Text className="text-[#8b949e] text-sm">App</Text>
              <Text className="text-[#e6edf3] text-sm font-semibold">
                GitLane
              </Text>
            </View>
            <View className="flex-row justify-between py-1.5">
              <Text className="text-[#8b949e] text-sm">Engine</Text>
              <Text className="text-[#e6edf3] text-sm font-semibold">
                isomorphic-git
              </Text>
            </View>
            <View className="flex-row justify-between py-1.5">
              <Text className="text-[#8b949e] text-sm">Platform</Text>
              <Text className="text-[#e6edf3] text-sm font-semibold">
                Expo / React Native
              </Text>
            </View>
          </View>
        </View>

        {/* Danger zone */}
        <View className="mt-6">
          <Text className="text-[#f85149] text-xs font-bold uppercase tracking-wider mb-3">
            Danger Zone
          </Text>
          <View className="rounded-lg bg-[#161b22] border border-[#f8514933] p-4">
            <Text className="text-[#c9d1d9] text-sm mb-3">
              Delete all local repositories. This action cannot be undone.
            </Text>
            <TouchableOpacity
              className="py-2 rounded-md border border-[#f85149] items-center"
              onPress={handleDeleteAll}
            >
              <Text className="text-[#f85149] text-sm font-semibold">
                Delete All Repos
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
