import { useCallback, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  FlatList,
} from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import JSZip from 'jszip'
import { useFocusEffect } from 'expo-router'

import { listRepos, getRepoPath } from '../services/repoService'
import { initRepo, getLog } from '../services/gitService'
import { exportPatchSince } from '../services/transferService'

// ─── helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// ─── component ──────────────────────────────────────────────────────

type Repo = { name: string; path: string; isGitRepo: boolean }

export default function TransferScreen() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  // Patch sync state
  const [showPatchSync, setShowPatchSync] = useState(false)
  const [patchCommits, setPatchCommits] = useState<any[]>([])
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [loadingCommits, setLoadingCommits] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setRepos(await listRepos())
    } catch {}
  }, [])

  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh]),
  )

  // ── EXPORT ────────────────────────────────────────────────────────

  const handleExport = async () => {
    if (!selected) {
      Alert.alert('Select a repo', 'Tap a repository from the list first.')
      return
    }

    setBusy(true)
    setStatus('Zipping repository…')

    try {
      const repoDir = getRepoPath(selected)
      const zip = new JSZip()

      const addFolder = async (folderUri: string, prefix: string) => {
        const names = await FileSystem.readDirectoryAsync(folderUri)
        for (const name of names) {
          const fullUri = folderUri + '/' + name
          const info = await FileSystem.getInfoAsync(fullUri)
          if (info.isDirectory) {
            await addFolder(fullUri, prefix + name + '/')
          } else {
            const content = await FileSystem.readAsStringAsync(fullUri, {
              encoding: FileSystem.EncodingType.Base64,
            })
            zip.file(prefix + name, content, { base64: true })
          }
        }
      }

      await addFolder(repoDir, '')

      setStatus('Generating zip file…')
      const base64Zip = await zip.generateAsync({ type: 'base64' })

      const zipPath = FileSystem.cacheDirectory + selected + '.zip'
      await FileSystem.writeAsStringAsync(zipPath, base64Zip, {
        encoding: FileSystem.EncodingType.Base64,
      })

      setStatus('Opening share sheet…')

      const canShare = await Sharing.isAvailableAsync()
      if (!canShare) {
        Alert.alert(
          'Sharing not available',
          'This device does not support sharing.',
        )
        return
      }

      await Sharing.shareAsync(zipPath, {
        mimeType: 'application/zip',
        dialogTitle: `Share ${selected}.zip`,
        UTI: 'public.zip-archive',
      })

      setStatus(`Exported ${selected}.zip ✓`)
    } catch (e: any) {
      Alert.alert('Export Error', e.message)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  // ── IMPORT ────────────────────────────────────────────────────────

  const handleImport = async () => {
    setBusy(true)
    setStatus('Picking file…')

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/zip',
        copyToCacheDirectory: true,
      })

      if (result.canceled || !result.assets?.length) {
        setStatus('')
        setBusy(false)
        return
      }

      const uri = result.assets[0].uri
      const fileName = result.assets[0].name ?? 'imported-repo.zip'
      const repoName = fileName
        .replace(/\.zip$/i, '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')

      setStatus(`Reading ${fileName}…`)
      const zipData = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })

      setStatus('Extracting files…')
      const zip = await JSZip.loadAsync(zipData, { base64: true })
      const entries = Object.keys(zip.files)

      // Create repo via git service (initialises .git)
      // If the zip already contains .git, we skip init and just write files
      const hasGitDir = entries.some(
        (e) => e === '.git/' || e.startsWith('.git/'),
      )

      const targetDir = getRepoPath(repoName)
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true })

      if (!hasGitDir) {
        // Init a fresh git repo then overlay the files
        try {
          await initRepo(repoName)
        } catch {}
      }

      let count = 0
      for (const entryName of entries) {
        const entry = zip.files[entryName]
        if (entry.dir) {
          await FileSystem.makeDirectoryAsync(targetDir + '/' + entryName, {
            intermediates: true,
          })
        } else {
          const content = await entry.async('base64')
          const destPath = targetDir + '/' + entryName
          const folder = destPath.substring(0, destPath.lastIndexOf('/'))
          await FileSystem.makeDirectoryAsync(folder, { intermediates: true })
          await FileSystem.writeAsStringAsync(destPath, content, {
            encoding: FileSystem.EncodingType.Base64,
          })
          count++
        }
      }

      setStatus(`Imported "${repoName}" (${count} files) ✓`)
      Alert.alert(
        'Success',
        `Repository "${repoName}" imported with ${count} files.`,
      )
      refresh()
    } catch (e: any) {
      Alert.alert('Import Error', e.message)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  // ── PATCH SYNC ─────────────────────────────────────────────────────

  const loadPatchCommits = async () => {
    if (!selected) return
    setLoadingCommits(true)
    try {
      const log = await getLog(selected, { depth: 50 })
      setPatchCommits(
        log.map((e: any) => ({
          oid: e.oid,
          message: e.commit?.message ?? '',
          author: e.commit?.author?.name ?? '',
          timestamp: e.commit?.author?.timestamp ?? 0,
        })),
      )
    } catch {
      setPatchCommits([])
    } finally {
      setLoadingCommits(false)
    }
  }

  const handlePatchExport = async () => {
    if (!selected || !selectedCommit) {
      Alert.alert('Select a commit', 'Pick a commit to export changes since')
      return
    }

    setBusy(true)
    setStatus('Generating patch…')

    try {
      const patch = await exportPatchSince(selected, selectedCommit)
      const json = JSON.stringify(patch, null, 2)

      const patchPath =
        FileSystem.cacheDirectory + `${selected}-patch-${Date.now()}.json`
      await FileSystem.writeAsStringAsync(patchPath, json, {
        encoding: FileSystem.EncodingType.UTF8,
      })

      setStatus('Opening share sheet…')
      const canShare = await Sharing.isAvailableAsync()
      if (!canShare) {
        Alert.alert('Sharing not available')
        return
      }

      await Sharing.shareAsync(patchPath, {
        mimeType: 'application/json',
        dialogTitle: `Share patch for ${selected}`,
      })

      setStatus(
        `Exported patch: ${patch.files.length} files, ${patch.commits.length} commits ✓`,
      )
    } catch (e: any) {
      Alert.alert('Patch Export Error', e.message)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────

  return (
    <ScrollView
      className="flex-1 bg-[#0d1117]"
      contentContainerStyle={{ paddingBottom: 160 }}
    >
      {/* Header */}
      <View className="px-4 pt-6 pb-3">
        <Text className="text-[#e6edf3] text-xl font-bold">
          Transfer Repository
        </Text>
        <Text className="text-[#484f58] text-sm mt-1">
          Export as .zip via any sharing channel, or import a .zip file
        </Text>
      </View>

      {/* Repo picker */}
      <View className="px-4 mb-2">
        <Text className="text-[#8b949e] text-xs font-semibold uppercase tracking-wider mb-2">
          Select repo to export
        </Text>
      </View>

      <FlatList
        data={repos}
        keyExtractor={(item) => item.name}
        className="max-h-52 px-4"
        renderItem={({ item }) => (
          <TouchableOpacity
            className={`flex-row items-center justify-between px-3 py-2.5 mb-1.5 rounded-lg border ${
              selected === item.name
                ? 'bg-[#1f6feb22] border-[#1f6feb]'
                : 'bg-[#161b22] border-[#30363d]'
            }`}
            onPress={() => setSelected(item.name)}
          >
            <View className="flex-row items-center gap-2">
              <Text className="text-base">📁</Text>
              <Text className="text-[#e6edf3] text-sm font-medium">
                {item.name}
              </Text>
            </View>
            {selected === item.name && (
              <Text className="text-[#58a6ff] text-xs">● selected</Text>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text className="text-[#484f58] text-sm text-center py-4">
            No repositories found
          </Text>
        }
      />

      {/* Actions */}
      <View className="px-4 mt-4 gap-3">
        <TouchableOpacity
          className={`py-3 rounded-lg items-center ${
            selected && !busy ? 'bg-[#238636]' : 'bg-[#21262d]'
          }`}
          onPress={handleExport}
          disabled={busy}
        >
          <Text
            className={`font-semibold text-base ${
              selected && !busy ? 'text-white' : 'text-[#484f58]'
            }`}
          >
            📤 Export & Share .zip
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`py-3 rounded-lg items-center border ${
            busy
              ? 'bg-[#21262d] border-[#30363d]'
              : 'bg-[#161b22] border-[#30363d]'
          }`}
          onPress={handleImport}
          disabled={busy}
        >
          <Text
            className={`font-semibold text-base ${
              busy ? 'text-[#484f58]' : 'text-[#58a6ff]'
            }`}
          >
            📥 Import .zip file
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      {(busy || status) && (
        <View className="px-4 mt-4 flex-row items-center gap-2">
          {busy && <ActivityIndicator color="#58a6ff" size="small" />}
          <Text className="text-[#8b949e] text-sm flex-1">{status}</Text>
        </View>
      )}

      {/* ── Incremental Patch Sync ── */}
      <View className="px-4 mt-6">
        <TouchableOpacity
          className="flex-row items-center justify-between py-2"
          onPress={() => {
            setShowPatchSync(!showPatchSync)
            if (!showPatchSync && selected) loadPatchCommits()
          }}
        >
          <View>
            <Text className="text-[#e6edf3] text-base font-bold">
              📋 Incremental Patch Sync
            </Text>
            <Text className="text-[#484f58] text-xs mt-0.5">
              Export only changes since a specific commit
            </Text>
          </View>
          <Text className="text-[#8b949e]">{showPatchSync ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showPatchSync && (
          <View className="mt-2 rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
            {!selected ? (
              <View className="px-3 py-4 items-center">
                <Text className="text-[#484f58] text-sm">
                  Select a repository above first
                </Text>
              </View>
            ) : loadingCommits ? (
              <View className="py-4 items-center">
                <ActivityIndicator color="#58a6ff" size="small" />
              </View>
            ) : patchCommits.length === 0 ? (
              <View className="px-3 py-4 items-center">
                <Text className="text-[#484f58] text-sm">No commits found</Text>
              </View>
            ) : (
              <>
                <View className="px-3 py-2 bg-[#21262d] border-b border-[#30363d]">
                  <Text className="text-[#8b949e] text-xs">
                    Select the base commit (changes after this will be exported)
                  </Text>
                </View>
                <ScrollView style={{ maxHeight: 200 }}>
                  {patchCommits.map((c) => (
                    <TouchableOpacity
                      key={c.oid}
                      className={`px-3 py-2.5 border-b border-[#21262d] flex-row items-center ${
                        selectedCommit === c.oid ? 'bg-[#1f6feb22]' : ''
                      }`}
                      onPress={() => setSelectedCommit(c.oid)}
                    >
                      <View
                        className="w-4 h-4 rounded-full border mr-2 items-center justify-center"
                        style={{
                          borderColor:
                            selectedCommit === c.oid ? '#58a6ff' : '#30363d',
                          backgroundColor:
                            selectedCommit === c.oid
                              ? '#1f6feb'
                              : 'transparent',
                        }}
                      >
                        {selectedCommit === c.oid && (
                          <View className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-[#e6edf3] text-xs"
                          numberOfLines={1}
                        >
                          {c.message.trim()}
                        </Text>
                        <Text className="text-[#484f58] text-[10px]">
                          {c.oid.slice(0, 7)} ·{' '}
                          {c.timestamp
                            ? new Date(c.timestamp * 1000).toLocaleDateString()
                            : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  className={`mx-3 my-2 py-2 rounded-lg items-center ${
                    selectedCommit && !busy ? 'bg-[#238636]' : 'bg-[#21262d]'
                  }`}
                  onPress={handlePatchExport}
                  disabled={busy || !selectedCommit}
                >
                  <Text
                    className={`font-semibold text-sm ${
                      selectedCommit && !busy ? 'text-white' : 'text-[#484f58]'
                    }`}
                  >
                    📤 Export Patch
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  )
}
