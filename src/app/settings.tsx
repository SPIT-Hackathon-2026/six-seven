import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  Image,
} from 'react-native'

import { getAuthor, setAuthor } from '@/services/gitService';
import { getFreeDiskSpace, REPO_BASE_PATH } from '@/utils/path';
import { listRepos, deleteRepo } from '@/services/repoService'
import { useRouter } from 'expo-router'
import { setAuthenticated } from '@/utils/auth'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { User, HardDrive, Info, AlertTriangle, LogOut, Moon, Sun } from 'lucide-react-native'

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
