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
import { FolderGit2, DownloadCloud, UploadCloud, ClipboardCopy, ChevronUp, ChevronDown, Check } from 'lucide-react-native'

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
      className="flex-1 bg-neutral-100 dark:bg-black w-full"
      contentContainerStyle={{ paddingBottom: 160 }}
    >
      {/* Header */}
      <View className="px-5 pt-8 pb-4">
        <Text className="text-black dark:text-white text-2xl font-extrabold mb-1">
          Transfer Repository
        </Text>
        <Text className="text-neutral-500 text-sm">
          Export as .zip via any sharing channel, or import a .zip file
        </Text>
      </View>

      {/* Repo picker */}
      <View className="px-5 mb-3 mt-2">
        <Text className="text-neutral-500 text-xs font-bold uppercase tracking-widest ml-1">
          Select repo to export
        </Text>
      </View>

      <FlatList
        data={repos}
        keyExtractor={(item) => item.name}
        className="max-h-52 px-5"
        renderItem={({ item }) => (
          <TouchableOpacity
            className={`flex-row items-center justify-between px-4 py-3.5 mb-2 rounded-xl border ${
              selected === item.name
                ? 'bg-[#1f6feb11] border-[#1f6feb] dark:bg-[#1f6feb22]'
                : 'bg-white dark:bg-zinc-900 border-neutral-200 dark:border-zinc-800 '
            }`}
             onPress={() => setSelected(item.name)}
          >
            <View className="flex-row items-center gap-3">
              <FolderGit2 size={20} color={selected === item.name ? '#58a6ff' : '#8b949e'} />
              <Text className={`text-sm font-semibold ${selected === item.name ? 'text-[#58a6ff]' : 'text-black dark:text-neutral-100'}`}>
                {item.name}
              </Text>
            </View>
            {selected === item.name && (
              <Check size={18} color="#58a6ff" />
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text className="text-neutral-400 text-sm text-center py-4">
            No repositories found
          </Text>
        }
      />

      {/* Actions */}
      <View className="px-5 mt-4 gap-3">
        <TouchableOpacity
          className={`py-3.5 rounded-xl flex-row justify-center items-center gap-2  ${
            selected && !busy ? 'bg-[#238636]' : 'bg-neutral-200 dark:bg-zinc-800'
          }`}
          onPress={handleExport}
          disabled={busy}
        >
          <UploadCloud size={18} color={selected && !busy ? '#fff' : '#8b949e'} />
          <Text
            className={`font-bold text-sm ${
              selected && !busy ? 'text-white' : 'text-neutral-400'
            }`}
          >
            Export & Share .zip
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`py-3.5 rounded-xl flex-row justify-center items-center gap-2 border  ${
            busy
              ? 'bg-neutral-100 dark:bg-black border-neutral-200 dark:border-zinc-800'
              : 'bg-white dark:bg-zinc-900 border-neutral-200 dark:border-zinc-800'
          }`}
          onPress={handleImport}
          disabled={busy}
        >
          <DownloadCloud size={18} color={busy ? '#8b949e' : '#58a6ff'} />
          <Text
            className={`font-semibold text-sm ${
              busy ? 'text-neutral-400' : 'text-[#58a6ff]'
            }`}
          >
            Import .zip file
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      {(busy || status) && (
        <View className="px-5 mt-4 flex-row items-center gap-2">
          {busy && <ActivityIndicator color="#58a6ff" size="small" />}
          <Text className="text-neutral-500 text-sm font-medium flex-1">{status}</Text>
        </View>
      )}

      {/* ── Incremental Patch Sync ── */}
      <View className="px-5 mt-8 border-t border-neutral-200 dark:border-zinc-800 pt-6">
        <TouchableOpacity
          className="flex-row items-center justify-between py-2"
          onPress={() => {
            setShowPatchSync(!showPatchSync)
            if (!showPatchSync && selected) loadPatchCommits()
          }}
        >
          <View className="flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 items-center justify-center">
              <ClipboardCopy size={18} color="#8b949e" />
            </View>
            <View>
              <Text className="text-black dark:text-neutral-100 text-base font-bold">
                Incremental Patch Sync
              </Text>
              <Text className="text-neutral-500 text-xs mt-0.5">
                Export changes since a specific commit
              </Text>
            </View>
          </View>
          {showPatchSync ? <ChevronUp size={20} color="#8b949e" /> : <ChevronDown size={20} color="#8b949e" />}
        </TouchableOpacity>

        {showPatchSync && (
          <View className="mt-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden ">
            {!selected ? (
              <View className="px-4 py-5 items-center">
                <Text className="text-neutral-500 text-sm font-medium">
                  Select a repository above first
                </Text>
              </View>
            ) : loadingCommits ? (
              <View className="py-6 items-center">
                <ActivityIndicator color="#58a6ff" size="small" />
              </View>
            ) : patchCommits.length === 0 ? (
              <View className="px-4 py-5 items-center">
                <Text className="text-neutral-500 text-sm">No commits found</Text>
              </View>
            ) : (
              <>
                <View className="px-4 py-3 bg-neutral-50 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
                  <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider">
                    Select the base commit
                  </Text>
                </View>
                <ScrollView style={{ maxHeight: 240 }}>
                  {patchCommits.map((c) => (
                    <TouchableOpacity
                      key={c.oid}
                      className={`px-4 py-3 border-b border-neutral-100 dark:border-zinc-800 flex-row items-center ${
                        selectedCommit === c.oid ? 'bg-[#1f6feb11]' : ''
                      }`}
                      onPress={() => setSelectedCommit(c.oid)}
                    >
                      <View
                        className="w-4 h-4 rounded-full border mr-3 items-center justify-center"
                        style={{
                          borderColor:
                            selectedCommit === c.oid ? '#58a6ff' : '#8b949e',
                          backgroundColor:
                            selectedCommit === c.oid
                              ? '#1f6feb'
                              : 'transparent',
                        }}
                      >
                        {selectedCommit === c.oid && (
                          <View className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </View>
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-medium ${selectedCommit === c.oid ? 'text-[#58a6ff]' : 'text-black dark:text-neutral-200'}`}
                          numberOfLines={1}
                        >
                          {c.message.trim()}
                        </Text>
                        <Text className="text-neutral-400 text-[11px] mt-0.5">
                          {c.oid.slice(0, 7)} ·{' '}
                          {c.timestamp
                            ? new Date(c.timestamp * 1000).toLocaleDateString()
                            : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View className="p-3">
                  <TouchableOpacity
                    className={`py-3 rounded-lg flex-row justify-center items-center gap-2  ${
                      selectedCommit && !busy ? 'bg-[#238636]' : 'bg-neutral-100 dark:bg-black border border-neutral-200 dark:border-zinc-800'
                    }`}
                    onPress={handlePatchExport}
                    disabled={busy || !selectedCommit}
                  >
                    <UploadCloud size={16} color={selectedCommit && !busy ? '#fff' : '#8b949e'} />
                    <Text
                      className={`font-bold text-sm ${
                        selectedCommit && !busy ? 'text-white' : 'text-neutral-400'
                      }`}
                    >
                      Export Patch
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  )
}
