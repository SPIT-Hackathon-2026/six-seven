import { useCallback, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  FlatList,
} from 'react-native'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'

import { currentBranch, getStatus, listBranches, commitAll, stageAll } from '@/services/gitService'

type RepoStatus = {
  branch: string
  branches: string[]
  modifiedCount: number
  files: { filepath: string; status: string }[]
  loading: boolean
}

export default function RepoDetailScreen() {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name: string }>()
  const [repo, setRepo] = useState<RepoStatus>({
    branch: 'main',
    branches: [],
    modifiedCount: 0,
    files: [],
    loading: true,
  })
  const [showBranchPicker, setShowBranchPicker] = useState(false)
  const [committing, setCommitting] = useState(false)

  const loadRepoData = useCallback(async () => {
    if (!name) return
    setRepo((prev) => ({ ...prev, loading: true }))
    try {
      const [branch, branches, status] = await Promise.all([
        currentBranch(name),
        listBranches(name),
        getStatus(name),
      ])

      const branchName = branch ?? 'main'
      const modified = status.filter((s) => s.status !== 'unmodified')

      setRepo({
        branch: branchName,
        branches,
        modifiedCount: modified.length,
        files: modified,
        loading: false,
      })
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to load repo data')
      setRepo((prev) => ({ ...prev, loading: false }))
    }
  }, [name])

  useFocusEffect(
    useCallback(() => {
      loadRepoData()
    }, [loadRepoData]),
  )

  const handleCommit = useCallback(async () => {
    if (!name) return
    setCommitting(true)
    try {
      await stageAll(name)
      await commitAll(name, `Update from GitLane ${new Date().toLocaleTimeString()}`)
      Alert.alert('Success', 'Changes committed')
      await loadRepoData()
    } catch (err: any) {
      Alert.alert('Commit failed', err?.message ?? 'Could not commit')
    } finally {
      setCommitting(false)
    }
  }, [name, loadRepoData])

  if (!name) {
    return (
      <View className="flex-1 bg-[#0d1117] items-center justify-center">
        <Text className="text-[#e6edf3]">Invalid repository</Text>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#30363d]">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-[#58a6ff] text-2xl">‹</Text>
        </TouchableOpacity>
        <Text className="text-[#e6edf3] text-lg font-bold flex-1 text-center">{name}</Text>
        <TouchableOpacity onPress={() => Alert.alert('Options', 'More options coming')}>
          <Text className="text-[#8b949e] text-2xl">⋯</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Branch Section */}
        <View className="mt-4">
          <TouchableOpacity
            className="flex-row items-center justify-between py-3 px-2"
            onPress={() => setShowBranchPicker(!showBranchPicker)}
          >
            <View className="flex-row items-center gap-2">
              <Text className="text-[#e6edf3] font-semibold">Branch:</Text>
              <Text className="text-[#f0a65e] text-lg font-bold">{repo.branch}</Text>
            </View>
            <Text className="text-[#8b949e]">◇</Text>
          </TouchableOpacity>

          {showBranchPicker && (
            <View className="bg-[#161b22] rounded-lg border border-[#30363d] mt-2 mb-3">
              {repo.branches.map((branch) => (
                <TouchableOpacity
                  key={branch}
                  className={`px-3 py-2 border-b border-[#30363d] last:border-b-0 ${
                    branch === repo.branch ? 'bg-[#1f6feb22]' : ''
                  }`}
                  onPress={() => {
                    setShowBranchPicker(false)
                    // Branch checkout can be added
                  }}
                >
                  <Text
                    className={
                      branch === repo.branch
                        ? 'text-[#58a6ff] font-semibold'
                        : 'text-[#c9d1d9]'
                    }
                  >
                    {branch}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Status Section */}
        {repo.loading ? (
          <View className="mt-4 items-center">
            <ActivityIndicator color="#58a6ff" />
          </View>
        ) : (
          <>
            <View className="mt-4">
              <Text className="text-[#e6edf3] font-semibold text-base">
                Status: {repo.modifiedCount} modified file{repo.modifiedCount !== 1 ? 's' : ''}
              </Text>
            </View>

            {/* Action Buttons */}
            <View className="flex-row gap-2 mt-4">
              <TouchableOpacity
                className="flex-1 py-2.5 rounded-lg bg-[#1f6feb] items-center"
                onPress={handleCommit}
                disabled={committing}
              >
                {committing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text className="text-white font-semibold">Commit</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 py-2.5 rounded-lg bg-[#21262d] items-center">
                <Text className="text-[#e6edf3] font-semibold">Pull</Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 py-2.5 rounded-lg bg-[#21262d] items-center">
                <Text className="text-[#e6edf3] font-semibold">Push</Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 py-2.5 rounded-lg bg-[#21262d] items-center">
                <Text className="text-[#e6edf3] font-semibold">Branch</Text>
              </TouchableOpacity>
            </View>

            {/* Recent Commits */}
            <View className="mt-6">
              <TouchableOpacity className="flex-row items-center justify-between py-2">
                <Text className="text-[#e6edf3] font-bold text-base">Recent Commits</Text>
                <Text className="text-[#8b949e]">›</Text>
              </TouchableOpacity>
              <View className="flex-row gap-2 mt-2">
                <Text className="text-[#8b949e] text-lg">▬</Text>
                <Text className="text-[#8b949e] text-lg">▬</Text>
                <Text className="text-[#8b949e] text-lg">▬</Text>
              </View>
            </View>

            {/* Changed Files */}
            <View className="mt-6">
              <TouchableOpacity className="flex-row items-center justify-between py-2">
                <Text className="text-[#e6edf3] font-bold text-base">Changed Files</Text>
                <Text className="text-[#8b949e]">›</Text>
              </TouchableOpacity>

              {repo.files.length === 0 ? (
                <Text className="text-[#8b949e] text-sm mt-2">No changes</Text>
              ) : (
                <View className="mt-2">
                  {repo.files.slice(0, 5).map((file) => (
                    <TouchableOpacity
                      key={file.filepath}
                      className="flex-row items-center gap-2 py-2 px-2"
                    >
                      <Text className="text-lg">📄</Text>
                      <Text className="text-[#c9d1d9] text-sm flex-1" numberOfLines={1}>
                        {file.filepath}
                      </Text>
                      <Text className="text-[#8b949e] text-xs">{file.status}</Text>
                    </TouchableOpacity>
                  ))}
                  {repo.files.length > 5 && (
                    <Text className="text-[#8b949e] text-xs mt-2">
                      +{repo.files.length - 5} more
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* Branches */}
            <View className="mt-6">
              <TouchableOpacity className="flex-row items-center justify-between py-2">
                <Text className="text-[#e6edf3] font-bold text-base">Branches</Text>
                <Text className="text-[#8b949e]">›</Text>
              </TouchableOpacity>
              <View className="mt-2">
                <Text className="text-[#8b949e] text-sm">
                  {repo.branches.length} local branch{repo.branches.length !== 1 ? 'es' : ''}
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}
