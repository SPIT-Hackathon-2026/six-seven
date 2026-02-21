import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
<<<<<<< HEAD
  Image,
=======
  ActivityIndicator,
>>>>>>> 1867e689f2b344e482df06502fbedb98ed3bef0c
} from 'react-native'

import { getAuthor, setAuthor } from '@/services/gitService';
import { getFreeDiskSpace, REPO_BASE_PATH } from '@/utils/path';
import { listRepos, deleteRepo } from '@/services/repoService'
import { useRouter } from 'expo-router'
import { setAuthenticated } from '@/utils/auth'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { User, HardDrive, Info, AlertTriangle, LogOut, Moon, Sun, Github, Link2, Unlink2 } from 'lucide-react-native'
import { getGitHubAuth, saveGitHubAuth, clearGitHubAuth, validatePAT } from '@/services/githubAuth'
import { setAutoSync } from '@/services/offlineSyncService'
import { getPendingCount, clearCompleted, retryErrors, getQueue } from '@/services/offlineSyncService'

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
  const router = useRouter()
  const { colorScheme, setColorScheme } = useColorScheme()
  const [authorName, setAuthorName] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')
  const [saved, setSaved] = useState(false)
  const [diskSpace, setDiskSpace] = useState<string>('...')
  const [repoCount, setRepoCount] = useState(0)
  const [repoBasePath, setRepoBasePath] = useState('')
  const [ghToken, setGhToken] = useState('')
  const [ghUsername, setGhUsername] = useState<string | null>(null)
  const [ghSaving, setGhSaving] = useState(false)
  const [autoSyncOn, setAutoSyncOn] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [queueErrors, setQueueErrors] = useState(0)

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
      try {
        const auth = await getGitHubAuth()
        if (auth?.username) setGhUsername(auth.username)
      } catch { /* not linked */ }
      // Load sync queue info
      try {
        const q = await getQueue()
        setPendingCount(q.filter((i: any) => i.status === 'pending').length)
        setQueueErrors(q.filter((i: any) => i.status === 'error').length)
      } catch { /* ignore */ }
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

  const handleLinkGitHub = useCallback(async () => {
    if (!ghToken.trim()) {
      Alert.alert('Error', 'Please paste your GitHub Personal Access Token')
      return
    }
    setGhSaving(true)
    try {
      const user = await validatePAT(ghToken.trim())
      await saveGitHubAuth(ghToken.trim(), user.login)
      setGhUsername(user.login)
      setGhToken('')
      Alert.alert('Connected!', `Linked as ${user.login}`)
    } catch (err: any) {
      Alert.alert('Invalid token', err?.message ?? 'Could not validate PAT')
    } finally {
      setGhSaving(false)
    }
  }, [ghToken])

  const handleUnlinkGitHub = useCallback(async () => {
    Alert.alert('Unlink GitHub', 'Remove your GitHub token from this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          await clearGitHubAuth()
          setGhUsername(null)
          setGhToken('')
        },
      },
    ])
  }, [])

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

  const handleLogout = useCallback(() => {
    setAuthenticated(false)
    router.replace('/login')
  }, [router])

  return (
    <View className="flex-1 bg-white dark:bg-black">
      {/* Header */}
      <View className="px-5 py-4 border-b border-neutral-200 dark:border-zinc-800">
        <Text className="text-black dark:text-white text-lg font-bold">Settings</Text>
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 160 }}
      >
        {/* Preferences */}
        <View className="mt-2">
          <View className="flex-row items-center mb-3">
            {colorScheme === 'dark' ? <Moon size={16} color="#8b949e" /> : <Sun size={16} color="#8b949e" />}
            <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider ml-2">
              Preferences
            </Text>
          </View>
          <View className="rounded-lg bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4 mb-6">
            <View className="flex-row items-center justify-between">
              <Text className="text-black dark:text-white text-sm font-medium">Dark Mode</Text>
              <TouchableOpacity
                className="w-12 h-6 rounded-full p-1"
                style={{ backgroundColor: colorScheme === 'dark' ? '#2ea043' : '#d1d5db' }}
                onPress={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
              >
                <View 
                  className="w-4 h-4 bg-white rounded-full dark:translate-x-6 transition-transform" 
                  style={{ transform: [{ translateX: colorScheme === 'dark' ? 24 : 0 }] }}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Git Author */}
        <View className="mt-1">
          <View className="flex-row items-center mb-3">
            <User size={16} color="#8b949e" />
            <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider ml-2">
              Git Author
            </Text>
          </View>
          <View className="rounded-lg bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4">
            <Text className="text-neutral-900 dark:text-white text-sm mb-1.5 font-medium">Name</Text>
            <TextInput
              className="bg-white dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
              value={authorName}
              onChangeText={setAuthorName}
              placeholder="Your Name"
              placeholderTextColor="#8b949e"
            />
            <Text className="text-neutral-900 dark:text-white text-sm mb-1.5 mt-3 font-medium">Email</Text>
            <TextInput
              className="bg-white dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
              value={authorEmail}
              onChangeText={setAuthorEmail}
              placeholder="user@example.com"
              placeholderTextColor="#8b949e"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity
              className="mt-4 py-2.5 rounded-md bg-[#1f6feb] items-center"
              onPress={handleSaveAuthor}
            >
              <Text className="text-white text-sm font-semibold">
                {saved ? '✓ Saved' : 'Save Author'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* GitHub Integration */}
        <View className="mt-6">
          <View className="flex-row items-center mb-3">
            <Github size={16} color="#8b949e" />
            <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider ml-2">
              GitHub
            </Text>
          </View>
          <View className="rounded-lg bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4">
            {ghUsername ? (
              <View>
                <View className="flex-row items-center mb-3">
                  <Link2 size={16} color="#2ea043" />
                  <Text className="text-[#2ea043] text-sm font-semibold ml-2">
                    Connected as @{ghUsername}
                  </Text>
                </View>
                <Text className="text-neutral-500 text-xs mb-3">
                  You can now push, pull and clone from GitHub.
                </Text>
                <TouchableOpacity
                  className="py-2.5 rounded-md bg-red-500/10 border border-red-500/30 items-center flex-row justify-center gap-2"
                  onPress={handleUnlinkGitHub}
                >
                  <Unlink2 size={14} color="#f85149" />
                  <Text className="text-[#f85149] text-sm font-semibold">Unlink GitHub</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <Text className="text-black dark:text-white text-sm mb-2 font-medium">
                  Personal Access Token
                </Text>
                <Text className="text-neutral-500 text-xs mb-3">
                  Create a PAT at github.com → Settings → Developer settings → Tokens (classic).{'\n'}
                  Required scopes: repo
                </Text>
                <TextInput
                  className="bg-white dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm font-mono"
                  value={ghToken}
                  onChangeText={setGhToken}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  placeholderTextColor="#8b949e"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
                <TouchableOpacity
                  className="mt-4 py-2.5 rounded-md bg-[#2ea043] items-center flex-row justify-center gap-2"
                  onPress={handleLinkGitHub}
                  disabled={ghSaving}
                >
                  {ghSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Github size={16} color="#fff" />
                      <Text className="text-white text-sm font-semibold">Connect GitHub</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Sync Configuration */}
        {ghUsername && (
          <View className="mt-6">
            <View className="flex-row items-center mb-3">
              <Link2 size={16} color="#8b949e" />
              <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider ml-2">
                Sync
              </Text>
            </View>
            <View className="rounded-lg bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-black dark:text-white text-sm font-medium">Auto-sync when online</Text>
                <TouchableOpacity
                  className="w-12 h-6 rounded-full p-1"
                  style={{ backgroundColor: autoSyncOn ? '#2ea043' : '#d1d5db' }}
                  onPress={() => {
                    const next = !autoSyncOn
                    setAutoSyncOn(next)
                    setAutoSync(next)
                  }}
                >
                  <View
                    className="w-4 h-4 bg-white rounded-full"
                    style={{ transform: [{ translateX: autoSyncOn ? 24 : 0 }] }}
                  />
                </TouchableOpacity>
              </View>
              <View className="flex-row justify-between py-1.5">
                <Text className="text-neutral-500 text-sm font-medium">Pending pushes</Text>
                <Text className="text-black dark:text-white text-sm font-semibold">{pendingCount}</Text>
              </View>
              {queueErrors > 0 && (
                <View className="flex-row justify-between items-center py-1.5">
                  <Text className="text-red-500 text-sm font-medium">{queueErrors} failed</Text>
                  <TouchableOpacity
                    className="py-1 px-3 rounded bg-red-500/10"
                    onPress={async () => {
                      await retryErrors()
                      const q = await getQueue()
                      setPendingCount(q.filter((i: any) => i.status === 'pending').length)
                      setQueueErrors(q.filter((i: any) => i.status === 'error').length)
                    }}
                  >
                    <Text className="text-red-500 text-xs font-semibold">Retry All</Text>
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                className="mt-3 py-2 rounded-md bg-neutral-200 dark:bg-zinc-800 items-center"
                onPress={async () => {
                  await clearCompleted()
                  const q = await getQueue()
                  setPendingCount(q.filter((i: any) => i.status === 'pending').length)
                  setQueueErrors(q.filter((i: any) => i.status === 'error').length)
                }}
              >
                <Text className="text-neutral-600 dark:text-neutral-300 text-sm font-medium">Clear Completed</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Storage Info */}
        <View className="mt-6">
          <View className="flex-row items-center mb-3">
            <HardDrive size={16} color="#8b949e" />
            <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider ml-2">
              Storage
            </Text>
          </View>
          <View className="rounded-lg bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4">
            <View className="flex-row justify-between py-1.5">
              <Text className="text-neutral-500 text-sm font-medium">Free disk space</Text>
              <Text className="text-black dark:text-white text-sm font-semibold">
                {diskSpace}
              </Text>
            </View>
            <View className="flex-row justify-between py-1.5">
              <Text className="text-neutral-500 text-sm font-medium">Repositories</Text>
              <Text className="text-black dark:text-white text-sm font-semibold">
                {repoCount}
              </Text>
            </View>
            <View className="py-1.5">
              <Text className="text-neutral-500 text-sm font-medium">Data path</Text>
              <Text className="text-neutral-400 text-xs mt-0.5" numberOfLines={2}>
                {repoBasePath}
              </Text>
            </View>
          </View>
        </View>

        {/* About */}
        <View className="mt-6">
          <View className="flex-row items-center mb-3">
            <Info size={16} color="#8b949e" />
            <Text className="text-neutral-500 text-xs font-bold uppercase tracking-wider ml-2">
              About
            </Text>
          </View>
          <View className="rounded-lg bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4">
            {/* Logo branding */}
            <View className="items-center py-3 mb-3 border-b border-neutral-200 dark:border-zinc-800">
              <Image
                source={require('@/assets/images/logo.png')}
                style={{ width: 140, height: 140, marginBottom: 8 }}
                resizeMode="contain"
              />
              <Text className="text-black dark:text-white text-base font-bold">GitLane</Text>
              <Text className="text-neutral-400 text-xs mt-0.5">Mobile Git Client</Text>
            </View>
            <View className="flex-row justify-between py-1.5">
              <Text className="text-neutral-500 text-sm font-medium">App</Text>
              <Text className="text-black dark:text-white text-sm font-semibold">
                GitLane
              </Text>
            </View>
            <View className="flex-row justify-between py-1.5">
              <Text className="text-neutral-500 text-sm font-medium">Engine</Text>
              <Text className="text-black dark:text-white text-sm font-semibold">
                isomorphic-git
              </Text>
            </View>
            <View className="flex-row justify-between py-1.5">
              <Text className="text-neutral-500 text-sm font-medium">Platform</Text>
              <Text className="text-black dark:text-white text-sm font-semibold">
                Expo / React Native
              </Text>
            </View>
          </View>
        </View>

      
       

        {/* Logout Button */}
        <TouchableOpacity
          className="mt-8 mb-6 py-3.5 items-center justify-center rounded-lg bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row gap-2"
          onPress={handleLogout}
        >
          <LogOut size={18} color="#ef4444" />
          <Text className="text-[#ef4444] font-bold text-base">Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
