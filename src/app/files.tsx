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
import { Search, FilePlus, FolderPlus, ChevronLeft, ChevronUp, ChevronDown, Folder as FolderIcon, File as FileIcon, X } from 'lucide-react-native'

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
      <View className="flex-1 bg-neutral-100 dark:bg-black w-full">
        <View className="flex-row items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-zinc-800">
          <TouchableOpacity onPress={() => setEditingFile(null)} className="flex-row items-center">
            <ChevronLeft size={20} color="#58a6ff" />
            <Text className="text-[#58a6ff] text-base font-semibold ml-1">
              Back
            </Text>
          </TouchableOpacity>
          <Text
            className="text-black dark:text-white text-sm font-bold flex-1 text-center"
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
            className="text-black dark:text-neutral-100 text-sm p-4 flex-1"
            style={{ fontFamily: 'monospace', minHeight: 400 }}
            value={fileContent}
            onChangeText={setFileContent}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            scrollEnabled={false}
          />
        </ScrollView>
        <View className="px-5 py-2 border-t border-neutral-200 dark:border-zinc-800">
          <Text className="text-neutral-500 text-xs">{editingFile}</Text>
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black w-full">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-zinc-800">
        <Text className="text-black dark:text-white text-lg font-bold">Files</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            className="px-3 py-1.5 rounded-md bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center gap-1.5"
            onPress={() => {
              setShowSearch(!showSearch)
              setSearchResults([])
            }}
          >
            <Search size={14} color="#8b949e" />
            <Text className="text-neutral-600 dark:text-neutral-400 text-xs font-medium">Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="px-3 py-1.5 rounded-md bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center gap-1.5"
            onPress={() => {
              setShowNew('file')
              setNewName('')
            }}
          >
            <FilePlus size={14} color="#8b949e" />
            <Text className="text-neutral-600 dark:text-neutral-400 text-xs font-medium">File</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="px-3 py-1.5 rounded-md bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center gap-1.5"
            onPress={() => {
              setShowNew('folder')
              setNewName('')
            }}
          >
            <FolderPlus size={14} color="#8b949e" />
            <Text className="text-neutral-600 dark:text-neutral-400 text-xs font-medium">Folder</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search panel */}
      {showSearch && selectedRepo && (
        <View className="mx-5 mt-3 mb-1 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-4 ">
          <View className="flex-row gap-2 mb-3">
            <TouchableOpacity
              className={`px-3 py-1.5 rounded-md ${searchMode === 'filename' ? 'bg-[#1f6feb]' : 'bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800'}`}
              onPress={() => setSearchMode('filename')}
            >
              <Text
                className={`text-xs font-medium ${searchMode === 'filename' ? 'text-white' : 'text-neutral-500'}`}
              >
                Filename
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`px-3 py-1.5 rounded-md ${searchMode === 'content' ? 'bg-[#1f6feb]' : 'bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800'}`}
              onPress={() => setSearchMode('content')}
            >
              <Text
                className={`text-xs font-medium ${searchMode === 'content' ? 'text-white' : 'text-neutral-500'}`}
              >
                Content
              </Text>
            </TouchableOpacity>
          </View>
          <View className="flex-row gap-2">
            <TextInput
              className="flex-1 bg-neutral-50 dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={
                searchMode === 'filename'
                  ? 'Search filenames…'
                  : 'Search in file contents…'
              }
              placeholderTextColor="#8b949e"
              onSubmitEditing={handleSearch}
              autoFocus
            />
            <TouchableOpacity
              className="px-4 py-2 rounded-md bg-[#1f6feb] justify-center"
              onPress={handleSearch}
              disabled={searching}
            >
              <Text className="text-white text-sm font-semibold">
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
                    className="py-3 px-2 border-b border-neutral-100 dark:border-zinc-800"
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
                    <Text className="text-[#58a6ff] text-xs font-semibold" numberOfLines={1}>
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
        className="mx-5 mt-3 px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 flex-row items-center justify-between "
        onPress={() => setShowRepoPicker(!showRepoPicker)}
      >
        <Text className="text-black dark:text-white font-semibold">
          {selectedRepo ?? 'Select repo'}
        </Text>
        {showRepoPicker ? <ChevronUp size={16} color="#8b949e" /> : <ChevronDown size={16} color="#8b949e" />}
      </TouchableOpacity>
      {showRepoPicker && (
        <View className="mx-5 mt-1 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 max-h-40 ">
          <ScrollView>
            {repos.map((r) => (
              <TouchableOpacity
                key={r}
                className="px-4 py-3 border-b border-neutral-100 dark:border-zinc-800"
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
                      : 'text-neutral-500'
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
        <View className="flex-row items-center mx-5 mt-3 flex-wrap bg-white dark:bg-zinc-900 px-3 py-2 rounded-lg border border-neutral-200 dark:border-zinc-800 ">
          <TouchableOpacity onPress={() => loadDir('')}>
            <Text className="text-[#58a6ff] text-xs font-bold">
              {selectedRepo}
            </Text>
          </TouchableOpacity>
          {crumbs.map((crumb, idx) => (
            <View key={idx} className="flex-row items-center">
              <Text className="text-neutral-400 text-xs mx-1.5">/</Text>
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
        <View className="mx-5 mt-3 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 p-3 flex-row items-center gap-2 ">
          <TextInput
            className="flex-1 bg-neutral-50 dark:bg-black text-black dark:text-white px-3 py-2 rounded-md border border-neutral-200 dark:border-zinc-800 text-sm"
            value={newName}
            onChangeText={setNewName}
            placeholder={showNew === 'file' ? 'filename.txt' : 'folder-name'}
            placeholderTextColor="#8b949e"
            autoFocus
          />
          <TouchableOpacity
            className="px-4 py-2 rounded-md bg-[#1f6feb] justify-center"
            onPress={handleCreate}
          >
            <Text className="text-white text-sm font-semibold">Create</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowNew(null)} className="p-2">
            <X size={18} color="#8b949e" />
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
            <Text className="text-neutral-500">No repository selected</Text>
          </View>
        ) : loading && tree.length === 0 ? (
          <View className="mt-8 items-center">
            <ActivityIndicator color="#58a6ff" />
          </View>
        ) : tree.length === 0 ? (
          <View className="mt-8 items-center">
            <Text className="text-neutral-500 text-base">Empty directory</Text>
            <Text className="text-neutral-400 text-sm mt-1">
              Create a file or folder to get started
            </Text>
          </View>
        ) : (
          <View className="bg-white dark:bg-zinc-900 rounded-xl border border-neutral-200 dark:border-zinc-800  mt-3 overflow-hidden">
            {crumbs.length > 0 && (
              <TouchableOpacity
                className="flex-row items-center py-3.5 px-4 border-b border-neutral-100 dark:border-zinc-800"
                onPress={handleBack}
              >
                <ChevronLeft size={18} color="#58a6ff" />
                <Text className="text-[#58a6ff] text-sm font-semibold ml-1">Up a level</Text>
              </TouchableOpacity>
            )}
            {tree.map((node, index) => (
              <TouchableOpacity
                key={node.relPath}
                className={`flex-row items-center py-3.5 px-4 ${index !== tree.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                onPress={() => handleNavigate(node)}
                onLongPress={() => handleDeleteItem(node)}
              >
                <View className="mr-3">
                  {node.isDirectory ? <FolderIcon size={20} color="#58a6ff" /> : <FileIcon size={20} color="#8b949e" />}
                </View>
                <Text className="text-black dark:text-neutral-200 text-sm flex-1 font-medium">
                  {node.name}
                </Text>
                {node.isDirectory && (
                  <ChevronLeft size={16} color="#8b949e" style={{ transform: [{ rotate: '180deg'}] }} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
