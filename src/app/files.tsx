import { useCallback, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import * as FileSystem from 'expo-file-system/legacy'

type TreeNode = {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
  expanded?: boolean
}

const PROJECT_ROOT = FileSystem.documentDirectory || ''

async function loadDirectory(path: string): Promise<TreeNode[]> {
  try {
    const names = await FileSystem.readDirectoryAsync(path)
    const items: TreeNode[] = []

    for (const name of names) {
      if (name.startsWith('.')) continue
      const fullPath = `${path}/${name}`
      const info = await FileSystem.getInfoAsync(fullPath)
      items.push({
        name,
        path: fullPath,
        isDirectory: info.isDirectory === true,
      })
    }

    return items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return b.isDirectory ? 1 : -1
      return a.name.localeCompare(b.name)
    })
  } catch (err) {
    console.error('Failed to load directory:', err)
    return []
  }
}

function FileTreeNode({
  node,
  level,
  onToggle,
}: {
  node: TreeNode
  level: number
  onToggle: (path: string) => void
}) {
  const icon = node.isDirectory
    ? node.expanded
      ? '▼'
      : '▶'
    : '  '
  const typeIcon = node.isDirectory ? '📁' : '📄'

  return (
    <View>
      <TouchableOpacity
        className="flex-row items-center py-2"
        style={{ paddingLeft: level * 16 }}
        onPress={() => node.isDirectory && onToggle(node.path)}
      >
        <Text className="text-[#8b949e] w-4">{node.isDirectory ? icon : ' '}</Text>
        <Text className="mx-1">{typeIcon}</Text>
        <Text className="text-[#c9d1d9] flex-1 text-sm">{node.name}</Text>
        {node.isDirectory && node.expanded && node.children?.length === 0 && (
          <ActivityIndicator size="small" color="#8b949e" />
        )}
      </TouchableOpacity>

      {node.expanded && node.children && (
        <>
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} level={level + 1} onToggle={onToggle} />
          ))}
        </>
      )}
    </View>
  )
}

export default function FilesScreen() {
  const router = useRouter()
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)

  const loadRootFiles = useCallback(async () => {
    setLoading(true)
    try {
      const items = await loadDirectory(PROJECT_ROOT)
      setTree(items)
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      loadRootFiles()
    }, [loadRootFiles]),
  )

  const handleToggle = useCallback(async (path: string) => {
    setTree((prevTree) => {
      const updateNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((node) => {
          if (node.path === path) {
            return {
              ...node,
              expanded: !node.expanded,
              children:
                !node.expanded && node.children === undefined ? [] : node.children,
            }
          }
          return {
            ...node,
            children: node.children ? updateNode(node.children) : undefined,
          }
        })
      }
      return updateNode(prevTree)
    })

    // Load children if not already loaded
    setTree((prevTree) => {
      const expandedNotLoaded: TreeNode[] = []

      const findNode = (nodes: TreeNode[], targetPath: string): TreeNode | null => {
        for (const node of nodes) {
          if (node.path === targetPath) return node
          if (node.children) {
            const found = findNode(node.children, targetPath)
            if (found) return found
          }
        }
        return null
      }

      const node = findNode(prevTree, path)
      if (node?.expanded && (!node.children || node.children.length === 0)) {
        loadDirectory(path).then((children) => {
          setTree((tree) => {
            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
              return nodes.map((n) => {
                if (n.path === path) {
                  return { ...n, children }
                }
                return {
                  ...n,
                  children: n.children ? updateNode(n.children) : undefined,
                }
              })
            }
            return updateNode(tree)
          })
        })
      }

      return prevTree
    })
  }, [])

  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#30363d]">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-[#58a6ff] text-2xl">‹</Text>
        </TouchableOpacity>
        <Text className="text-[#e6edf3] text-lg font-bold flex-1 text-center">Files</Text>
        <TouchableOpacity onPress={() => Alert.alert('Options', 'More options coming')}>
          <Text className="text-[#8b949e] text-2xl">⋯</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#58a6ff" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-3" contentContainerStyle={{ paddingBottom: 140 }}>
          {tree.length === 0 ? (
            <View className="mt-4 items-center">
              <Text className="text-[#8b949e]">No files found</Text>
            </View>
          ) : (
            tree.map((node) => (
              <FileTreeNode key={node.path} node={node} level={0} onToggle={handleToggle} />
            ))
          )}
        </ScrollView>
      )}
    </View>
  )
}
