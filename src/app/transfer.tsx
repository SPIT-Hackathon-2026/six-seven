import { useCallback, useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  FlatList,
  Modal,
} from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import JSZip from 'jszip'
import QRCode from 'react-native-qrcode-svg'
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera'
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
  // QR Export
  const [qrVisible, setQrVisible] = useState(false)
  const [qrData, setQrData] = useState<string | null>(null)
  // QR Import
  const [scannerVisible, setScannerVisible] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const cameraRef = useRef(null)
  // ── QR EXPORT ─────────────────────────────────────────────────────
  const handleExportQR = async () => {
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
      const byteLength = base64Zip.length * 0.75 // base64 to bytes
      if (byteLength > 3000) {
        Alert.alert('Repo too large for QR', 'Please select a smaller repository. QR codes can only encode very small files (a few KB).')
        setStatus('')
        setBusy(false)
        return
      }
      setQrData(base64Zip)
      setQrVisible(true)
      setStatus('')
    } catch (e: any) {
      Alert.alert('QR Export Error', e.message)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  // ── QR IMPORT ─────────────────────────────────────────────────────
  const openScanner = async () => {
    if (!cameraPermission || cameraPermission.status !== 'granted') {
      const { status } = await requestCameraPermission()
      if (status !== 'granted') {
        Alert.alert('Camera permission required', 'Please allow camera access to scan QR codes.')
        return
      }
    }
    setScanned(false)
    setScannerVisible(true)
  }

  const handleQrScanned = async (result: BarcodeScanningResult) => {
    if (scanned) return
    setScanned(true)
    setScannerVisible(false)
    setBusy(true)
    setStatus('Importing from QR…')
    try {
      const scannedData = result.data
      const zip = await JSZip.loadAsync(scannedData, { base64: true })
      const entries = Object.keys(zip.files)
      const repoName = 'qr-import-' + Date.now()
      const hasGitDir = entries.some(
        (e) => e === '.git/' || e.startsWith('.git/')
      )
      const targetDir = getRepoPath(repoName)
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true })
      if (!hasGitDir) {
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
      Alert.alert('Success', `Repository "${repoName}" imported with ${count} files.`)
      refresh()
    } catch (e: any) {
      Alert.alert('QR Import Error', e.message)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  // Patch sync state
  const [showPatchSync, setShowPatchSync] = useState(false)
  const [patchCommits, setPatchCommits] = useState<any[]>([])
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [loadingCommits, setLoadingCommits] = useState(false)

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
<<<<<<< HEAD
      className="flex-1 bg-[#0d1117]"
=======
      className="flex-1 bg-neutral-100 dark:bg-black w-full"
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
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
<<<<<<< HEAD
          className={`py-3 rounded-lg items-center border ${
            selected && !busy ? 'bg-[#21262d] border-[#30363d]' : 'bg-[#161b22] border-[#30363d]'
          }`}
          onPress={handleExportQR}
          disabled={busy || !selected}
        >
          <Text
            className={`font-semibold text-base ${
              selected && !busy ? 'text-[#f2e85c]' : 'text-[#484f58]'
            }`}
          >
            📱 Generate QR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="py-3 rounded-lg items-center border bg-[#161b22] border-[#30363d]"
          onPress={openScanner}
          disabled={busy}
        >
          <Text className="font-semibold text-base text-[#a6ff58]">
            📷 Scan QR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`py-3 rounded-lg items-center border ${
=======
          className={`py-3.5 rounded-xl flex-row justify-center items-center gap-2 border  ${
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
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
      {/* QR Modal */}
      <Modal
        visible={qrVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setQrVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#161b22', padding: 24, borderRadius: 16, alignItems: 'center', maxWidth: 340 }}>
            <Text style={{ color: '#e6edf3', fontWeight: 'bold', fontSize: 18, marginBottom: 12 }}>Scan to Import Repo</Text>
            {qrData && (
              <QRCode
                value={qrData}
                size={220}
                backgroundColor="#161b22"
                color="#58a6ff"
              />
            )}
            <Text style={{ color: '#8b949e', fontSize: 12, marginTop: 12, textAlign: 'center' }}>
              Only very small repos can be shared via QR. Scan this code on another device to import.
            </Text>
            <TouchableOpacity
              style={{ marginTop: 18, paddingVertical: 8, paddingHorizontal: 24, backgroundColor: '#30363d', borderRadius: 8 }}
              onPress={() => setQrVisible(false)}
            >
              <Text style={{ color: '#e6edf3', fontWeight: 'bold' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* QR Scanner Modal */}
      <Modal
        visible={scannerVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setScannerVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#161b22', padding: 16, borderRadius: 16, alignItems: 'center', maxWidth: 340 }}>
            <Text style={{ color: '#e6edf3', fontWeight: 'bold', fontSize: 18, marginBottom: 12 }}>Scan QR Code</Text>
            {(!cameraPermission || cameraPermission.status !== 'granted') ? (
              <Text style={{ color: '#f66', marginBottom: 12 }}>Camera permission denied.</Text>
            ) : (
              <CameraView
                ref={cameraRef}
                style={{ width: 240, height: 240, marginBottom: 12 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleQrScanned}
                enableTorch={false}
              />
            )}
            <TouchableOpacity
              style={{ marginTop: 8, paddingVertical: 8, paddingHorizontal: 24, backgroundColor: '#30363d', borderRadius: 8 }}
              onPress={() => setScannerVisible(false)}
            >
              <Text style={{ color: '#e6edf3', fontWeight: 'bold' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Status bar */}
      {(busy || status) && (
        <View className="px-5 mt-4 flex-row items-center gap-2">
          {busy && <ActivityIndicator color="#58a6ff" size="small" />}
          <Text className="text-neutral-500 text-sm font-medium flex-1">{status}</Text>
        </View>
      )}

      {/* ── Incremental Patch Sync ── */}
<<<<<<< HEAD
      <View className="px-4 mt-6">
=======
      <View className="px-5 mt-8 border-t border-neutral-200 dark:border-zinc-800 pt-6">
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
        <TouchableOpacity
          className="flex-row items-center justify-between py-2"
          onPress={() => {
            setShowPatchSync(!showPatchSync)
            if (!showPatchSync && selected) loadPatchCommits()
          }}
        >
<<<<<<< HEAD
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
=======
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
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
                  Select a repository above first
                </Text>
              </View>
            ) : loadingCommits ? (
<<<<<<< HEAD
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
=======
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
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
                      }`}
                      onPress={() => setSelectedCommit(c.oid)}
                    >
                      <View
<<<<<<< HEAD
                        className="w-4 h-4 rounded-full border mr-2 items-center justify-center"
                        style={{
                          borderColor:
                            selectedCommit === c.oid ? '#58a6ff' : '#30363d',
=======
                        className="w-4 h-4 rounded-full border mr-3 items-center justify-center"
                        style={{
                          borderColor:
                            selectedCommit === c.oid ? '#58a6ff' : '#8b949e',
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
                          backgroundColor:
                            selectedCommit === c.oid
                              ? '#1f6feb'
                              : 'transparent',
                        }}
                      >
                        {selectedCommit === c.oid && (
<<<<<<< HEAD
                          <View className="w-2 h-2 rounded-full bg-white" />
=======
                          <View className="w-1.5 h-1.5 rounded-full bg-white" />
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
                        )}
                      </View>
                      <View className="flex-1">
                        <Text
<<<<<<< HEAD
                          className="text-[#e6edf3] text-xs"
=======
                          className={`text-sm font-medium ${selectedCommit === c.oid ? 'text-[#58a6ff]' : 'text-black dark:text-neutral-200'}`}
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
                          numberOfLines={1}
                        >
                          {c.message.trim()}
                        </Text>
<<<<<<< HEAD
                        <Text className="text-[#484f58] text-[10px]">
=======
                        <Text className="text-neutral-400 text-[11px] mt-0.5">
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
                          {c.oid.slice(0, 7)} ·{' '}
                          {c.timestamp
                            ? new Date(c.timestamp * 1000).toLocaleDateString()
                            : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
<<<<<<< HEAD
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
=======
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
>>>>>>> b1072a8a07c76b46725fe4f5e13101bff41c2423
              </>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  )
}