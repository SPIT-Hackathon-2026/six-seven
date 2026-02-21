import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from 'expo-router'
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  HardDrive,
  GitBranch,
  FileCode,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  FolderGit2,
  Database,
  Cpu,
} from 'lucide-react-native'
import * as FileSystem from 'expo-file-system/legacy'
import {
  checkRepoHealth,
  listBranches,
  currentBranch as getCurrent,
  getLog,
  listTags,
  getRemoteUrl,
  listRemotes,
} from '@/services/gitService'
import { listRepos } from '@/services/repoService'

/* ───── helpers ───── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface HealthCheck {
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

/* ═══════════════════════════════════════════ */
/*              HEALTH DASHBOARD              */
/* ═══════════════════════════════════════════ */

export default function HealthScreen() {
  const { name } = useLocalSearchParams<{ name: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [checks, setChecks] = useState<HealthCheck[]>([])
  const [storageInfo, setStorageInfo] = useState<{
    gitSize: number
    workingSize: number
    totalSize: number
    objectCount: number
  } | null>(null)
  const [repoMeta, setRepoMeta] = useState<{
    branches: number
    tags: number
    commits: number
    currentBranch: string | null
    remoteUrl: string | null
    remoteCount: number
  } | null>(null)
  const [overallHealth, setOverallHealth] = useState<'healthy' | 'warning' | 'error'>('healthy')

  const REPO_BASE = `${FileSystem.documentDirectory}repos`

  // Recursive directory size calculator
  const getDirSize = async (path: string): Promise<number> => {
    try {
      const info = await FileSystem.getInfoAsync(path)
      if (!info.exists) return 0
      if (!info.isDirectory) return info.size ?? 0

      const items = await FileSystem.readDirectoryAsync(path)
      let total = 0
      for (const item of items) {
        total += await getDirSize(`${path}/${item}`)
      }
      return total
    } catch {
      return 0
    }
  }

  // Count objects in .git/objects
  const countObjects = async (repoPath: string): Promise<number> => {
    let count = 0
    try {
      const objDir = `${repoPath}/.git/objects`
      const dirs = await FileSystem.readDirectoryAsync(objDir)
      for (const d of dirs) {
        if (d === 'info' || d === 'pack') continue
        try {
          const files = await FileSystem.readDirectoryAsync(`${objDir}/${d}`)
          count += files.length
        } catch { /* not a dir */ }
      }
      // Count pack files
      try {
        const packs = await FileSystem.readDirectoryAsync(`${objDir}/pack`)
        count += packs.filter((f: string) => f.endsWith('.pack')).length * 100 // estimate
      } catch { /* no packs */ }
    } catch { /* no objects dir */ }
    return count
  }

  const runHealthChecks = useCallback(async () => {
    if (!name) return
    setScanning(true)

    const repoPath = `${REPO_BASE}/${name}`
    const healthChecks: HealthCheck[] = []

    // 1. Core health (HEAD, objects, refs)
    try {
      const health = await checkRepoHealth(name)
      if (health.healthy) {
        healthChecks.push({ label: 'Core Integrity', status: 'pass', detail: 'HEAD, objects, and refs are valid' })
      } else {
        for (const issue of health.issues) {
          healthChecks.push({ label: 'Core Integrity', status: 'fail', detail: issue })
        }
      }
    } catch (err: any) {
      healthChecks.push({ label: 'Core Integrity', status: 'fail', detail: err?.message ?? 'Check failed' })
    }

    // 2. Branch verification
    try {
      const branches = await listBranches(name)
      const current = await getCurrent(name)
      if (branches.length > 0 && current) {
        healthChecks.push({ label: 'Branch Health', status: 'pass', detail: `${branches.length} branches, current: ${current}` })
      } else if (branches.length > 0) {
        healthChecks.push({ label: 'Branch Health', status: 'warn', detail: `${branches.length} branches, but HEAD is detached` })
      } else {
        healthChecks.push({ label: 'Branch Health', status: 'warn', detail: 'No branches found' })
      }
    } catch {
      healthChecks.push({ label: 'Branch Health', status: 'fail', detail: 'Cannot read branches' })
    }

    // 3. Commit history check
    try {
      const log = await getLog(name, { depth: 5 })
      if (log && log.length > 0) {
        healthChecks.push({ label: 'Commit History', status: 'pass', detail: `Latest commit: ${log[0].oid?.slice(0, 7)}` })
      } else {
        healthChecks.push({ label: 'Commit History', status: 'warn', detail: 'No commits found (empty repo)' })
      }
    } catch {
      healthChecks.push({ label: 'Commit History', status: 'fail', detail: 'Cannot read commit log' })
    }

    // 4. .git directory structure
    const requiredDirs = ['objects', 'refs', 'refs/heads']
    for (const d of requiredDirs) {
      try {
        const info = await FileSystem.getInfoAsync(`${repoPath}/.git/${d}`)
        if (info.exists) {
          healthChecks.push({ label: `.git/${d}`, status: 'pass', detail: 'Directory exists' })
        } else {
          healthChecks.push({ label: `.git/${d}`, status: 'fail', detail: 'Missing directory' })
        }
      } catch {
        healthChecks.push({ label: `.git/${d}`, status: 'fail', detail: 'Cannot access' })
      }
    }

    // 5. HEAD file
    try {
      const headContent = await FileSystem.readAsStringAsync(`${repoPath}/.git/HEAD`)
      if (headContent.startsWith('ref:')) {
        healthChecks.push({ label: 'HEAD File', status: 'pass', detail: headContent.trim() })
      } else if (headContent.length === 41 || headContent.length === 40) {
        healthChecks.push({ label: 'HEAD File', status: 'warn', detail: 'Detached HEAD state' })
      } else {
        healthChecks.push({ label: 'HEAD File', status: 'fail', detail: 'Invalid HEAD content' })
      }
    } catch {
      healthChecks.push({ label: 'HEAD File', status: 'fail', detail: 'Cannot read HEAD' })
    }

    // 6. Config file
    try {
      await FileSystem.readAsStringAsync(`${repoPath}/.git/config`)
      healthChecks.push({ label: 'Config', status: 'pass', detail: 'Config file exists and readable' })
    } catch {
      healthChecks.push({ label: 'Config', status: 'warn', detail: 'No config file (default settings)' })
    }

    // 7. Remote check
    try {
      const url = await getRemoteUrl(name).catch(() => null)
      if (url) {
        healthChecks.push({ label: 'Remote Origin', status: 'pass', detail: url })
      } else {
        healthChecks.push({ label: 'Remote Origin', status: 'warn', detail: 'No remote configured (local-only)' })
      }
    } catch {
      healthChecks.push({ label: 'Remote Origin', status: 'warn', detail: 'Cannot read remotes' })
    }

    // Overall status
    const fails = healthChecks.filter((c) => c.status === 'fail').length
    const warns = healthChecks.filter((c) => c.status === 'warn').length
    setOverallHealth(fails > 0 ? 'error' : warns > 0 ? 'warning' : 'healthy')
    setChecks(healthChecks)
    setScanning(false)
  }, [name])

  const loadData = useCallback(async () => {
    if (!name) return
    setLoading(true)
    try {
      const repoPath = `${REPO_BASE}/${name}`

      // Storage info
      const [gitSize, workingSize, objCount] = await Promise.all([
        getDirSize(`${repoPath}/.git`),
        getDirSize(repoPath).then((total) => getDirSize(`${repoPath}/.git`).then((git) => total - git)),
        countObjects(repoPath),
      ])
      setStorageInfo({
        gitSize,
        workingSize,
        totalSize: gitSize + workingSize,
        objectCount: objCount,
      })

      // Repo metadata
      const [branches, tags, log, current, remoteUrl, remotes] = await Promise.all([
        listBranches(name).catch(() => []),
        listTags(name).catch(() => []),
        getLog(name, { depth: 200 }).catch(() => []),
        getCurrent(name).catch(() => null),
        getRemoteUrl(name).catch(() => null),
        listRemotes(name).catch(() => []),
      ])
      setRepoMeta({
        branches: branches.length,
        tags: tags.length,
        commits: log?.length ?? 0,
        currentBranch: current ?? null,
        remoteUrl: remoteUrl ?? null,
        remoteCount: remotes.length,
      })

      // Run checks
      await runHealthChecks()
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [name, runHealthChecks])

  useFocusEffect(useCallback(() => { loadData() }, [loadData]))

  const passCount = checks.filter((c) => c.status === 'pass').length
  const failCount = checks.filter((c) => c.status === 'fail').length
  const warnCount = checks.filter((c) => c.status === 'warn').length

  /* ═══════════════ RENDER ═══════════════ */

  return (
    <SafeAreaView className="flex-1 bg-neutral-100 dark:bg-black">
      {/* Header */}
      <View className="pt-4 pb-3 px-5 bg-white dark:bg-zinc-900 border-b border-neutral-200 dark:border-zinc-800">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={() => router.back()} className="p-1">
            <ArrowLeft size={20} color="#8b949e" />
          </TouchableOpacity>
          {overallHealth === 'healthy' ? (
            <ShieldCheck size={20} color="#3fb950" />
          ) : overallHealth === 'warning' ? (
            <ShieldAlert size={20} color="#d29922" />
          ) : (
            <ShieldAlert size={20} color="#f85149" />
          )}
          <Text className="text-black dark:text-white text-lg font-bold flex-1" numberOfLines={1}>
            Health — {name}
          </Text>
          <TouchableOpacity
            onPress={runHealthChecks}
            disabled={scanning}
            className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40"
          >
            {scanning ? (
              <ActivityIndicator size={12} color="#58a6ff" />
            ) : (
              <RefreshCw size={12} color="#58a6ff" />
            )}
            <Text className="text-blue-600 dark:text-blue-400 text-[11px] font-bold">Scan</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} tintColor="#58a6ff" />}
      >
        {loading && checks.length === 0 ? (
          <View className="mt-20 items-center">
            <ActivityIndicator size="large" color="#58a6ff" />
            <Text className="text-neutral-500 text-sm mt-3">Scanning repository...</Text>
          </View>
        ) : (
          <>
            {/* ── Overall Status Banner ── */}
            <View className={`mx-5 mt-4 p-4 rounded-xl border ${
              overallHealth === 'healthy'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/40'
                : overallHealth === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40'
            }`}>
              <View className="flex-row items-center gap-3 mb-2">
                {overallHealth === 'healthy' ? (
                  <CheckCircle2 size={24} color="#3fb950" />
                ) : overallHealth === 'warning' ? (
                  <AlertTriangle size={24} color="#d29922" />
                ) : (
                  <ShieldAlert size={24} color="#f85149" />
                )}
                <View>
                  <Text className={`text-lg font-bold ${
                    overallHealth === 'healthy' ? 'text-green-700 dark:text-green-400'
                    : overallHealth === 'warning' ? 'text-amber-700 dark:text-amber-400'
                    : 'text-red-700 dark:text-red-400'
                  }`}>
                    {overallHealth === 'healthy'
                      ? 'Repository is Healthy'
                      : overallHealth === 'warning'
                        ? 'Minor Issues Detected'
                        : 'Issues Found'}
                  </Text>
                  <Text className="text-neutral-500 text-xs mt-0.5">
                    {passCount} passed · {warnCount} warnings · {failCount} errors
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Storage Breakdown ── */}
            {storageInfo && (
              <>
                <SectionHeader icon={<HardDrive size={14} color="#58a6ff" />} title="Storage" />
                <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
                  {/* Size bar */}
                  <View className="px-4 pt-4 pb-2">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-black dark:text-white text-xl font-bold">
                        {formatBytes(storageInfo.totalSize)}
                      </Text>
                      <Text className="text-neutral-500 text-[10px]">total</Text>
                    </View>
                    <View className="h-3 rounded-full bg-neutral-100 dark:bg-zinc-800 overflow-hidden flex-row">
                      <View
                        style={{
                          width: `${storageInfo.totalSize > 0 ? (storageInfo.gitSize / storageInfo.totalSize) * 100 : 50}%`,
                          backgroundColor: '#58a6ff',
                          height: '100%',
                        }}
                      />
                      <View
                        style={{
                          flex: 1,
                          backgroundColor: '#3fb950',
                          height: '100%',
                        }}
                      />
                    </View>
                    <View className="flex-row justify-between mt-2">
                      <View className="flex-row items-center gap-1.5">
                        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: '#58a6ff' }} />
                        <Text className="text-neutral-500 text-[10px]">.git ({formatBytes(storageInfo.gitSize)})</Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: '#3fb950' }} />
                        <Text className="text-neutral-500 text-[10px]">Working tree ({formatBytes(storageInfo.workingSize)})</Text>
                      </View>
                    </View>
                  </View>
                  <View className="border-t border-neutral-100 dark:border-zinc-800 px-4 py-3 flex-row justify-between">
                    <Text className="text-neutral-500 text-xs">Git Objects</Text>
                    <Text className="text-black dark:text-white text-xs font-bold">~{storageInfo.objectCount}</Text>
                  </View>
                </View>
              </>
            )}

            {/* ── Repository Info ── */}
            {repoMeta && (
              <>
                <SectionHeader icon={<FolderGit2 size={14} color="#a371f7" />} title="Repository Info" />
                <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
                  <InfoRow label="Current Branch" value={repoMeta.currentBranch ?? 'detached'} icon={<GitBranch size={13} color="#3fb950" />} />
                  <InfoRow label="Total Branches" value={`${repoMeta.branches}`} icon={<GitBranch size={13} color="#8b949e" />} />
                  <InfoRow label="Tags" value={`${repoMeta.tags}`} icon={<FileCode size={13} color="#d29922" />} />
                  <InfoRow label="Commits" value={`${repoMeta.commits}`} icon={<Database size={13} color="#58a6ff" />} />
                  <InfoRow label="Remotes" value={`${repoMeta.remoteCount}`} icon={<Cpu size={13} color="#a371f7" />} />
                  {repoMeta.remoteUrl && (
                    <InfoRow label="Origin URL" value={repoMeta.remoteUrl} icon={<FolderGit2 size={13} color="#8b949e" />} isLast />
                  )}
                </View>
              </>
            )}

            {/* ── Health Checks ── */}
            <SectionHeader icon={<ShieldCheck size={14} color="#3fb950" />} title="Integrity Checks" />
            <View className="mx-5 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
              {checks.map((check, idx) => (
                <View
                  key={`${check.label}-${idx}`}
                  className={`flex-row items-center px-4 py-3 ${idx < checks.length - 1 ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}
                >
                  {check.status === 'pass' ? (
                    <CheckCircle2 size={15} color="#3fb950" />
                  ) : check.status === 'warn' ? (
                    <AlertTriangle size={15} color="#d29922" />
                  ) : (
                    <ShieldAlert size={15} color="#f85149" />
                  )}
                  <View className="ml-3 flex-1">
                    <Text className="text-black dark:text-neutral-200 text-sm font-medium">
                      {check.label}
                    </Text>
                    <Text className="text-neutral-500 text-[11px] mt-0.5" numberOfLines={2}>
                      {check.detail}
                    </Text>
                  </View>
                  <View className={`px-2 py-0.5 rounded-full ${
                    check.status === 'pass' ? 'bg-green-100 dark:bg-green-900/30'
                    : check.status === 'warn' ? 'bg-amber-100 dark:bg-amber-900/30'
                    : 'bg-red-100 dark:bg-red-900/30'
                  }`}>
                    <Text className={`text-[9px] font-bold ${
                      check.status === 'pass' ? 'text-green-600 dark:text-green-400'
                      : check.status === 'warn' ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                    }`}>
                      {check.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View className="h-8" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

/* ═══════ Sub-components ═══════ */

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View className="flex-row items-center gap-2 px-5 mt-5 mb-2.5">
      {icon}
      <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-wider">{title}</Text>
    </View>
  )
}

function InfoRow({ label, value, icon, isLast }: { label: string; value: string; icon: React.ReactNode; isLast?: boolean }) {
  return (
    <View className={`flex-row items-center px-4 py-3 ${!isLast ? 'border-b border-neutral-100 dark:border-zinc-800' : ''}`}>
      {icon}
      <Text className="text-neutral-500 text-sm ml-2.5 flex-1">{label}</Text>
      <Text className="text-black dark:text-white text-sm font-semibold" numberOfLines={1} style={{ maxWidth: 180 }}>
        {value}
      </Text>
    </View>
  )
}
