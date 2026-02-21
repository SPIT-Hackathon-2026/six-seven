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
import {
  CameraView,
  useCameraPermissions,
  BarcodeScanningResult,
} from 'expo-camera'
import { useFocusEffect } from 'expo-router'
import { FolderGit2, ChevronDown, ChevronUp } from 'lucide-react-native'

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

/** Max bytes per QR chunk – QR version 40 alphanumeric ≈ 4296 chars,
 *  but base64 is byte-mode so practical limit is ~2200 to keep it scannable. */
const QR_CHUNK_SIZE = 2200

// ─── component ──────────────────────────────────────────────────────

type Repo = { name: string; path: string; isGitRepo: boolean }

export default function TransferScreen() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  // QR Export (chunked)
  const [qrVisible, setQrVisible] = useState(false)
  const [qrChunks, setQrChunks] = useState<string[]>([])
  const [qrPage, setQrPage] = useState(0)
  // QR Import (multi-scan)
  const [scannerVisible, setScannerVisible] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const cameraRef = useRef(null)
  const [importChunks, setImportChunks] = useState<Record<number, string>>({})
  const [importTotal, setImportTotal] = useState(0)
  // ── QR EXPORT (chunked) ───────────────────────────────────────────
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

      // Split into chunks with header  "idx/total:payload"
      const totalChunks = Math.ceil(base64Zip.length / QR_CHUNK_SIZE)
      const chunks: string[] = []
      for (let i = 0; i < totalChunks; i++) {
        const payload = base64Zip.slice(i * QR_CHUNK_SIZE, (i + 1) * QR_CHUNK_SIZE)
        chunks.push(`${i}/${totalChunks}:${payload}`)
      }

      setQrChunks(chunks)
      setQrPage(0)
      setQrVisible(true)
      setStatus(`Split into ${totalChunks} QR code(s) (${formatBytes(base64Zip.length * 0.75)})`)
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
        Alert.alert(
          'Camera permission required',
          'Please allow camera access to scan QR codes.',
        )
        return
      }
    }
    setScanned(false)
    setImportChunks({})
    setImportTotal(0)
    setScannerVisible(true)
  }

  const handleQrScanned = async (result: BarcodeScanningResult) => {
    if (scanned) return
    const raw = result.data

    // Parse chunk header  "idx/total:payload"
    const headerEnd = raw.indexOf(':')
    if (headerEnd === -1) {
      // Legacy single-QR fallback
      setScanned(true)
      setScannerVisible(false)
      await importBase64Zip(raw)
      return
    }

    const header = raw.slice(0, headerEnd)
    const payload = raw.slice(headerEnd + 1)
    const [idxStr, totalStr] = header.split('/')
    const idx = parseInt(idxStr, 10)
    const total = parseInt(totalStr, 10)
    if (isNaN(idx) || isNaN(total)) {
      // Not a chunked QR – treat as legacy
      setScanned(true)
      setScannerVisible(false)
      await importBase64Zip(raw)
      return
    }

    setImportTotal(total)
    setImportChunks((prev) => {
      const updated = { ...prev, [idx]: payload }
      const collectedCount = Object.keys(updated).length
      setStatus(`Scanned chunk ${collectedCount} / ${total}`)

      if (collectedCount === total) {
        // All chunks collected – reassemble & import
        setScanned(true)
        setScannerVisible(false)
        const fullBase64 = Array.from({ length: total }, (_, i) => updated[i]).join('')
        importBase64Zip(fullBase64)
      }
      return updated
    })
  }

  /** Shared import logic used by both single and chunked QR flows */
  const importBase64Zip = async (base64Zip: string) => {
    setBusy(true)
    setStatus('Importing from QR…')
    try {
      const zip = await JSZip.loadAsync(base64Zip, { base64: true })
      const entries = Object.keys(zip.files)
      const repoName = 'qr-import-' + Date.now()
      const hasGitDir = entries.some(
        (e) => e === '.git/' || e.startsWith('.git/'),
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
      Alert.alert(
        'Success',
        `Repository "${repoName}" imported with ${count} files.`,
      )
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
      className="flex-1 bg-[#000000]"
      contentContainerStyle={{ paddingBottom: 160 }}
    >
      {/* Header */}
      <View className="px-4 pt-6 pb-3">
        <Text className="text-[#e6edf3] text-xl font-bold">
          Transfer Repository
        </Text>
        <Text className="text-[#8b949e] text-sm mt-1">
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
                ? 'bg-[#1f6feb11] border-[#1f6feb33]'
                : 'bg-[#0a0a0a] border-[#1a1a1a]'
            }`}
            onPress={() => setSelected(item.name)}
          >
            <View className="flex-row items-center gap-2">
              <FolderGit2 size={16} color={selected === item.name ? "#58a6ff" : "#8b949e"} />
              <Text className={`text-sm font-medium ${selected === item.name ? 'text-[#58a6ff]' : 'text-[#e6edf3]'}`}>
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
            selected && !busy ? 'bg-[#58a6ff]' : 'bg-[#111111]'
          }`}
          onPress={handleExport}
          disabled={busy}
        >
          <Text
            className={`font-semibold text-base ${
              selected && !busy ? 'text-[#000000]' : 'text-[#484f58]'
            }`}
          >
            Export & Share .zip
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`py-3 rounded-lg items-center border ${
            selected && !busy
              ? 'bg-[#0a0a0a] border-[#d2a8ff55]'
              : 'bg-[#0a0a0a] border-[#1a1a1a]'
          }`}
          onPress={handleExportQR}
          disabled={busy || !selected}
        >
          <Text
            className={`font-semibold text-base ${
              selected && !busy ? 'text-[#d2a8ff]' : 'text-[#484f58]'
            }`}
          >
            Generate QR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="py-3 rounded-lg items-center border bg-[#0a0a0a] border-[#1a1a1a]"
          onPress={openScanner}
          disabled={busy}
        >
          <Text className="font-semibold text-base text-[#7ee787]">
            Scan QR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`py-3 rounded-lg items-center border ${
            busy
              ? 'bg-[#111111] border-[#1a1a1a]'
              : 'bg-[#0a0a0a] border-[#1a1a1a]'
          }`}
          onPress={handleImport}
          disabled={busy}
        >
          <Text
            className={`font-semibold text-base ${
              busy ? 'text-[#484f58]' : 'text-[#58a6ff]'
            }`}
          >
            Import .zip file
          </Text>
        </TouchableOpacity>
      </View>
      {/* QR Modal (chunked pagination) */}
      <Modal
        visible={qrVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setQrVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: '#000a',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: '#0a0a0a',
              padding: 24,
              borderRadius: 16,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#1a1a1a',
              maxWidth: 340,
            }}
          >
            <Text
              style={{
                color: '#e6edf3',
                fontWeight: 'bold',
                fontSize: 18,
                marginBottom: 4,
              }}
            >
              Scan to Import Repo
            </Text>
            <Text
              style={{
                color: '#58a6ff',
                fontSize: 14,
                fontWeight: '600',
                marginBottom: 12,
              }}
            >
              QR {qrPage + 1} / {qrChunks.length}
            </Text>
            {qrChunks.length > 0 && (
              <QRCode
                value={qrChunks[qrPage]}
                size={220}
                backgroundColor="#0a0a0a"
                color="#58a6ff"
              />
            )}
            {/* Prev / Next navigation */}
            {qrChunks.length > 1 && (
              <View
                style={{
                  flexDirection: 'row',
                  marginTop: 14,
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <TouchableOpacity
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 18,
                    backgroundColor: qrPage > 0 ? '#1a1a1a' : '#111111',
                    borderRadius: 8,
                  }}
                  disabled={qrPage === 0}
                  onPress={() => setQrPage((p) => p - 1)}
                >
                  <Text
                    style={{
                      color: qrPage > 0 ? '#e6edf3' : '#484f58',
                      fontWeight: 'bold',
                    }}
                  >
                    ◀ Prev
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 18,
                    backgroundColor:
                      qrPage < qrChunks.length - 1 ? '#1a1a1a' : '#111111',
                    borderRadius: 8,
                  }}
                  disabled={qrPage >= qrChunks.length - 1}
                  onPress={() => setQrPage((p) => p + 1)}
                >
                  <Text
                    style={{
                      color:
                        qrPage < qrChunks.length - 1 ? '#e6edf3' : '#484f58',
                      fontWeight: 'bold',
                    }}
                  >
                    Next ▶
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            <Text
              style={{
                color: '#8b949e',
                fontSize: 12,
                marginTop: 12,
                textAlign: 'center',
              }}
            >
              {qrChunks.length === 1
                ? 'Scan this code on another device to import.'
                : `Show each QR code in order. The receiver must scan all ${qrChunks.length} codes.`}
            </Text>
            <TouchableOpacity
              style={{
                marginTop: 18,
                paddingVertical: 8,
                paddingHorizontal: 24,
                backgroundColor: '#1a1a1a',
                borderRadius: 8,
              }}
              onPress={() => setQrVisible(false)}
            >
              <Text style={{ color: '#e6edf3', fontWeight: 'bold' }}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* QR Scanner Modal (multi-chunk) */}
      <Modal
        visible={scannerVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setScannerVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: '#000a',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: '#0a0a0a',
              padding: 16,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: '#1a1a1a',
              alignItems: 'center',
              maxWidth: 340,
            }}
          >
            <Text
              style={{
                color: '#e6edf3',
                fontWeight: 'bold',
                fontSize: 18,
                marginBottom: 4,
              }}
            >
              Scan QR Code{importTotal > 1 ? 's' : ''}
            </Text>
            {importTotal > 0 && (
              <Text
                style={{
                  color: '#58a6ff',
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                Collected {Object.keys(importChunks).length} / {importTotal} chunks
              </Text>
            )}
            {!cameraPermission || cameraPermission.status !== 'granted' ? (
              <Text style={{ color: '#f66', marginBottom: 12 }}>
                Camera permission denied.
              </Text>
            ) : (
              <CameraView
                ref={cameraRef}
                style={{ width: 260, height: 260, marginBottom: 12, borderRadius: 8 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleQrScanned}
                enableTorch={false}
              />
            )}
            <Text
              style={{
                color: '#8b949e',
                fontSize: 11,
                textAlign: 'center',
                marginBottom: 8,
              }}
            >
              Point camera at each QR code in sequence.
              {importTotal > 1
                ? ' The sender should tap Next after each scan.'
                : ''}
            </Text>
            <TouchableOpacity
              style={{
                paddingVertical: 8,
                paddingHorizontal: 24,
                backgroundColor: '#1a1a1a',
                borderRadius: 8,
              }}
              onPress={() => setScannerVisible(false)}
            >
              <Text style={{ color: '#e6edf3', fontWeight: 'bold' }}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
              Incremental Patch Sync
            </Text>
            <Text className="text-[#484f58] text-xs mt-0.5">
              Export only changes since a specific commit
            </Text>
          </View>
          {showPatchSync ? <ChevronUp size={16} color="#8b949e" /> : <ChevronDown size={16} color="#8b949e" />}
        </TouchableOpacity>

        {showPatchSync && (
          <View className="mt-2 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] overflow-hidden">
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
                <View className="px-3 py-2 bg-[#111111] border-b border-[#1a1a1a]">
                  <Text className="text-[#8b949e] text-xs">
                    Select the base commit (changes after this will be exported)
                  </Text>
                </View>
                <ScrollView style={{ maxHeight: 200 }}>
                  {patchCommits.map((c) => (
                    <TouchableOpacity
                      key={c.oid}
                      className={`px-3 py-2.5 border-b border-[#111111] flex-row items-center ${
                        selectedCommit === c.oid ? 'bg-[#1f6feb15]' : ''
                      }`}
                      onPress={() => setSelectedCommit(c.oid)}
                    >
                      <View
                        className="w-4 h-4 rounded-full border mr-2 items-center justify-center"
                        style={{
                          borderColor:
                            selectedCommit === c.oid ? '#58a6ff' : '#1a1a1a',
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
                    selectedCommit && !busy ? 'bg-[#58a6ff]' : 'bg-[#111111]'
                  }`}
                  onPress={handlePatchExport}
                  disabled={busy || !selectedCommit}
                >
                  <Text
                    className={`font-semibold text-sm ${
                      selectedCommit && !busy ? 'text-[#000000]' : 'text-[#484f58]'
                    }`}
                  >
                    Export Patch
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
