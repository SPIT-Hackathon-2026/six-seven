import { useCallback, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  RefreshControl,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'

import { listRepos } from '@/services/repoService'
import {
  listFiles,
  readFile,
  writeFile,
  deleteFile,
  createDirectory,
  deleteDirectory,
  searchFiles,
  searchContent,
} from '@/services/fileService'

type TreeNode = {
  name: string
  relPath: string
  isDirectory: boolean
  children?: TreeNode[]
  expanded?: boolean
}

export default function FilesScreen() {
  const router = useRouter()
  const [repos, setRepos] = useState<string[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [showRepoPicker, setShowRepoPicker] = useState(false)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [crumbs, setCrumbs] = useState<string[]>([])

  // Editor state
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [saving, setSaving] = useState(false)

  // New file/folder dialog
  const [showNew, setShowNew] = useState<'file' | 'folder' | null>(null)
  const [newName, setNewName] = useState('')

  // Search state
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'filename' | 'content'>(
    'filename',
  )
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  // Load repos
  useFocusEffect(
    useCallback(() => {
      ;(async () => {
        const list = await listRepos()
        const names = list.map((r) => r.name)
        setRepos(names)
        if (names.length > 0 && !selectedRepo) setSelectedRepo(names[0])
      })()
    }, []),
  )

  // Load directory
  const loadDir = useCallback(
    async (subDir = '') => {
      if (!selectedRepo) return
      setLoading(true)
      try {
        const items = await listFiles(selectedRepo, subDir)
        const nodes: TreeNode[] = items
          .filter((i: any) => !i.name.startsWith('.'))
          .map((i: any) => ({
            name: i.name,
            relPath: subDir ? `${subDir}/${i.name}` : i.name,
            isDirectory: i.isDirectory,
          }))
          .sort((a: TreeNode, b: TreeNode) => {
            if (a.isDirectory !== b.isDirectory) return b.isDirectory ? 1 : -1
            return a.name.localeCompare(b.name)
          })
        setTree(nodes)
        setCrumbs(subDir ? subDir.split('/') : [])
      } catch (err: any) {
        Alert.alert('Error', err?.message ?? 'Failed to list files')
      } finally {
        setLoading(false)
      }
    },
    [selectedRepo],
  )

  useFocusEffect(
    useCallback(() => {
      if (selectedRepo) loadDir('')
    }, [selectedRepo, loadDir]),
  )

  const currentDir = crumbs.join('/')

  const handleNavigate = useCallback(
    (node: TreeNode) => {
      if (node.isDirectory) {
        loadDir(node.relPath)
      } else {
        // Open file editor
        ;(async () => {
          try {
            const content = await readFile(selectedRepo!, node.relPath)
            setFileContent(content)
            setEditingFile(node.relPath)
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Cannot read file')
          }
        })()
      }
    },
    [selectedRepo, loadDir],
  )

  const handleBack = useCallback(() => {
    if (crumbs.length === 0) return
    const parent = crumbs.slice(0, -1).join('/')
    loadDir(parent)
  }, [crumbs, loadDir])

  const handleSaveFile = useCallback(async () => {
    if (!selectedRepo || !editingFile) return
    setSaving(true)
    try {
      await writeFile(selectedRepo, editingFile, fileContent)
      Alert.alert('Saved', editingFile)
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? '')
    } finally {
      setSaving(false)
    }
  }, [selectedRepo, editingFile, fileContent])

  const handleDeleteItem = useCallback(
    (node: TreeNode) => {
      Alert.alert('Delete', `Delete ${node.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (node.isDirectory) {
                await deleteDirectory(selectedRepo!, node.relPath)
              } else {
                await deleteFile(selectedRepo!, node.relPath)
              }
              loadDir(currentDir)
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Delete failed')
            }
          },
        },
      ])
    },
    [selectedRepo, currentDir, loadDir],
  )

  const handleCreate = useCallback(async () => {
    if (!selectedRepo || !newName.trim()) return
    const path = currentDir ? `${currentDir}/${newName.trim()}` : newName.trim()
    try {
      if (showNew === 'folder') {
        await createDirectory(selectedRepo, path)
      } else {
        await writeFile(selectedRepo, path, '')
      }
      setShowNew(null)
      setNewName('')
      loadDir(currentDir)
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Create failed')
    }
  }, [selectedRepo, currentDir, showNew, newName, loadDir])

  const handleSearch = useCallback(async () => {
    if (!selectedRepo || !searchQuery.trim()) return
    setSearching(true)
    try {
      if (searchMode === 'filename') {
        const results = await searchFiles(selectedRepo, searchQuery.trim())
        setSearchResults(
          results.map((f: any) => ({
            path: f.path,
            name: f.name,
            type: 'file',
          })),
        )
      } else {
        const results = await searchContent(selectedRepo, searchQuery.trim())
        setSearchResults(
          results.map((m: any) => ({
            path: m.path,
            name: m.path.split('/').pop(),
            line: m.line,
            content: m.content,
            type: 'content',
          })),
        )
      }
    } catch (err: any) {
      Alert.alert('Search error', err?.message ?? 'Search failed')
    } finally {
      setSearching(false)
    }
  }, [selectedRepo, searchQuery, searchMode])

  // File editor view
  if (editingFile) {
    return (
      <View className="flex-1 bg-[#0d1117]">
        <View className="flex-row items-center justify-between px-5 py-3 border-b border-[#30363d]">
          <TouchableOpacity onPress={() => setEditingFile(null)}>
            <Text className="text-[#58a6ff] text-base font-semibold">
              ‹ Back
            </Text>
          </TouchableOpacity>
          <Text
            className="text-[#e6edf3] text-sm font-bold flex-1 text-center"
            numberOfLines={1}
          >
            {editingFile.split('/').pop()}
          </Text>
          <TouchableOpacity onPress={handleSaveFile} disabled={saving}>
            <Text className="text-[#58a6ff] text-base font-semibold">
              {saving ? '...' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView className="flex-1" keyboardShouldPersistTaps="always">
          <TextInput
            className="text-[#c9d1d9] text-sm p-4 flex-1"
            style={{ fontFamily: 'monospace', minHeight: 400 }}
            value={fileContent}
            onChangeText={setFileContent}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            scrollEnabled={false}
          />
        </ScrollView>
        <View className="px-5 py-2 border-t border-[#30363d]">
          <Text className="text-[#484f58] text-xs">{editingFile}</Text>
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#30363d]">
        <Text className="text-[#e6edf3] text-lg font-bold">Files</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            className="px-3 py-1 rounded-md bg-[#21262d]"
            onPress={() => {
              setShowSearch(!showSearch)
              setSearchResults([])
            }}
          >
            <Text className="text-[#c9d1d9] text-xs">🔍 Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="px-3 py-1 rounded-md bg-[#21262d]"
            onPress={() => {
              setShowNew('file')
              setNewName('')
            }}
          >
            <Text className="text-[#c9d1d9] text-xs">+ File</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="px-3 py-1 rounded-md bg-[#21262d]"
            onPress={() => {
              setShowNew('folder')
              setNewName('')
            }}
          >
            <Text className="text-[#c9d1d9] text-xs">+ Folder</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search panel */}
      {showSearch && selectedRepo && (
        <View className="mx-5 mt-2 rounded-lg bg-[#161b22] border border-[#30363d] p-3">
          <View className="flex-row gap-2 mb-2">
            <TouchableOpacity
              className={`px-3 py-1 rounded-md ${searchMode === 'filename' ? 'bg-[#1f6feb]' : 'bg-[#21262d]'}`}
              onPress={() => setSearchMode('filename')}
            >
              <Text
                className={`text-xs ${searchMode === 'filename' ? 'text-white' : 'text-[#c9d1d9]'}`}
              >
                Filename
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`px-3 py-1 rounded-md ${searchMode === 'content' ? 'bg-[#1f6feb]' : 'bg-[#21262d]'}`}
              onPress={() => setSearchMode('content')}
            >
              <Text
                className={`text-xs ${searchMode === 'content' ? 'text-white' : 'text-[#c9d1d9]'}`}
              >
                Content
              </Text>
            </TouchableOpacity>
          </View>
          <View className="flex-row gap-2">
            <TextInput
              className="flex-1 bg-[#0d1117] text-[#e6edf3] px-3 py-1.5 rounded-md border border-[#30363d] text-sm"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={
                searchMode === 'filename'
                  ? 'Search filenames…'
                  : 'Search in file contents…'
              }
              placeholderTextColor="#484f58"
              onSubmitEditing={handleSearch}
              autoFocus
            />
            <TouchableOpacity
              className="px-3 py-1.5 rounded-md bg-[#1f6feb]"
              onPress={handleSearch}
              disabled={searching}
            >
              <Text className="text-white text-sm">
                {searching ? '...' : 'Go'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search results */}
          {searchResults.length > 0 && (
            <View className="mt-2 max-h-60">
              <ScrollView>
                <Text className="text-[#8b949e] text-xs mb-1">
                  {searchResults.length} result
                  {searchResults.length !== 1 ? 's' : ''}
                </Text>
                {searchResults.map((r, idx) => (
                  <TouchableOpacity
                    key={`${r.path}-${r.line ?? idx}`}
                    className="py-2 border-b border-[#21262d]"
                    onPress={async () => {
                      try {
                        const content = await readFile(selectedRepo!, r.path)
                        setFileContent(content)
                        setEditingFile(r.path)
                        setShowSearch(false)
                      } catch (err: any) {
                        Alert.alert('Error', err?.message ?? 'Cannot open file')
                      }
                    }}
                  >
                    <Text className="text-[#58a6ff] text-xs" numberOfLines={1}>
                      📄 {r.path}
                      {r.line ? `:${r.line}` : ''}
                    </Text>
                    {r.content && (
                      <Text
                        className="text-[#8b949e] text-[11px] mt-0.5"
                        numberOfLines={1}
                        style={{ fontFamily: 'monospace' }}
                      >
                        {r.content}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          {searching && (
            <View className="mt-2 items-center">
              <ActivityIndicator color="#58a6ff" size="small" />
            </View>
          )}
        </View>
      )}

      {/* Repo picker */}
      <TouchableOpacity
        className="mx-5 mt-3 px-4 py-2.5 rounded-lg bg-[#161b22] border border-[#30363d] flex-row items-center justify-between"
        onPress={() => setShowRepoPicker(!showRepoPicker)}
      >
        <Text className="text-[#e6edf3] font-semibold">
          {selectedRepo ?? 'Select repo'}
        </Text>
        <Text className="text-[#8b949e]">{showRepoPicker ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {showRepoPicker && (
        <View className="mx-5 mt-1 rounded-lg bg-[#161b22] border border-[#30363d] max-h-40">
          <ScrollView>
            {repos.map((r) => (
              <TouchableOpacity
                key={r}
                className="px-4 py-2.5 border-b border-[#21262d]"
                onPress={() => {
                  setSelectedRepo(r)
                  setShowRepoPicker(false)
                  setCrumbs([])
                }}
              >
                <Text
                  className={
                    r === selectedRepo
                      ? 'text-[#58a6ff] font-semibold'
                      : 'text-[#c9d1d9]'
                  }
                >
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Breadcrumbs */}
      {selectedRepo && (
        <View className="flex-row items-center mx-5 mt-2 flex-wrap">
          <TouchableOpacity onPress={() => loadDir('')}>
            <Text className="text-[#58a6ff] text-xs font-semibold">
              {selectedRepo}
            </Text>
          </TouchableOpacity>
          {crumbs.map((crumb, idx) => (
            <View key={idx} className="flex-row items-center">
              <Text className="text-[#484f58] text-xs mx-1">/</Text>
              <TouchableOpacity
                onPress={() => loadDir(crumbs.slice(0, idx + 1).join('/'))}
              >
                <Text className="text-[#58a6ff] text-xs font-semibold">
                  {crumb}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* New file/folder dialog */}
      {showNew && (
        <View className="mx-5 mt-2 rounded-lg bg-[#161b22] border border-[#30363d] p-3 flex-row items-center gap-2">
          <TextInput
            className="flex-1 bg-[#0d1117] text-[#e6edf3] px-3 py-1.5 rounded-md border border-[#30363d] text-sm"
            value={newName}
            onChangeText={setNewName}
            placeholder={showNew === 'file' ? 'filename.txt' : 'folder-name'}
            placeholderTextColor="#484f58"
            autoFocus
          />
          <TouchableOpacity
            className="px-3 py-1.5 rounded-md bg-[#1f6feb]"
            onPress={handleCreate}
          >
            <Text className="text-white text-sm">Create</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowNew(null)}>
            <Text className="text-[#8b949e] text-sm">✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        className="flex-1 px-5 mt-2"
        contentContainerStyle={{ paddingBottom: 160 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => loadDir(currentDir)}
            tintColor="#58a6ff"
          />
        }
      >
        {!selectedRepo ? (
          <View className="mt-8 items-center">
            <Text className="text-[#8b949e]">No repository selected</Text>
          </View>
        ) : loading && tree.length === 0 ? (
          <View className="mt-8 items-center">
            <ActivityIndicator color="#58a6ff" />
          </View>
        ) : tree.length === 0 ? (
          <View className="mt-8 items-center">
            <Text className="text-[#8b949e] text-base">Empty directory</Text>
            <Text className="text-[#484f58] text-sm mt-1">
              Create a file or folder to get started
            </Text>
          </View>
        ) : (
          <>
            {crumbs.length > 0 && (
              <TouchableOpacity
                className="flex-row items-center py-2.5 border-b border-[#21262d]"
                onPress={handleBack}
              >
                <Text className="text-[#58a6ff] text-sm">↑ ..</Text>
              </TouchableOpacity>
            )}
            {tree.map((node) => (
              <TouchableOpacity
                key={node.relPath}
                className="flex-row items-center py-2.5 border-b border-[#21262d]"
                onPress={() => handleNavigate(node)}
                onLongPress={() => handleDeleteItem(node)}
              >
                <Text className="mr-2 text-base">
                  {node.isDirectory ? '📁' : '📄'}
                </Text>
                <Text className="text-[#c9d1d9] text-sm flex-1">
                  {node.name}
                </Text>
                {node.isDirectory && (
                  <Text className="text-[#484f58] text-sm">›</Text>
                )}
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}
