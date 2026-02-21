import { useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import {
  Search,
  Clock,
  GitCommitVertical,
  Sparkles,
  X,
  ChevronRight,
  FileCode,
  User,
  CalendarDays,
  Tag,
  ArrowRight,
} from 'lucide-react-native'

import { listRepos } from '@/services/repoService'
import {
  searchCommits,
  parseQuery,
  getSuggestions,
  SUGGESTED_QUERIES,
  aiSummarizeResults,
  isAIAvailable,
} from '@/services/nlSearchService'

/* ─── helpers ─────────────────────────────────── */

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

function formatDate(ts: number) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

type SearchResult = {
  repo: string
  oid: string
  shortOid: string
  message: string
  author: string
  email: string
  timestamp: number
  score: number
  matchReasons: string[]
}

type Repo = { name: string; path: string; isGitRepo: boolean }

type ParsedFilters = {
  authors: string[]
  files: string[]
  keywords: string[]
  dateRange: { since?: number; until?: number } | null
  repo: string | null
  type: string | null
  limit: number
}

/* ═══════════ COMPONENT ═══════════ */
export default function SearchScreen() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [repos, setRepos] = useState<Repo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [aiIntent, setAiIntent] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const aiEnabled = isAIAvailable()

  // Load repos on focus
  useFocusEffect(
    useCallback(() => {
      listRepos().then((r) => setRepos(r.filter((x: Repo) => x.isGitRepo !== false)))
    }, []),
  )

  // Parsed filter preview
  const parsedFilters = useMemo((): ParsedFilters | null => {
    if (query.length < 3) return null
    return parseQuery(query) as ParsedFilters
  }, [query])

  const suggestions = useMemo(() => getSuggestions(query), [query])

  const handleSearch = useCallback(
    async (q?: string) => {
      const searchQuery = q ?? query
      if (!searchQuery.trim()) return
      Keyboard.dismiss()
      setSearching(true)
      setHasSearched(true)
      setAiIntent(null)
      setAiSummary(null)

      try {
        // @ts-ignore — searchCommits is JS, types don't align
        const response = await searchCommits(searchQuery, selectedRepo)
        // Handle both old array format and new object format
        const resultItems = Array.isArray(response) ? response : (response?.results ?? [])
        const intent = Array.isArray(response) ? null : (response?.aiIntent ?? null)

        setResults(resultItems)
        setAiIntent(intent)

        // Add to recent queries (dedup)
        setRecentQueries((prev) => {
          const next = [searchQuery, ...prev.filter((x) => x !== searchQuery)]
          return next.slice(0, 8)
        })

        // Async AI summary (non-blocking)
        if (resultItems.length > 0 && isAIAvailable()) {
          setLoadingSummary(true)
          aiSummarizeResults(searchQuery, resultItems)
            .then((summary) => setAiSummary(summary))
            .catch(() => {})
            .finally(() => setLoadingSummary(false))
        }
      } catch (err) {
        console.warn('Search error:', err)
        setResults([])
      } finally {
        setSearching(false)
      }
    },
    [query, selectedRepo],
  )

  const clearSearch = useCallback(() => {
    setQuery('')
    setResults([])
    setHasSearched(false)
    setAiIntent(null)
    setAiSummary(null)
  }, [])

  /* ═══════ RENDER ═══════ */
  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black">
      {/* ── Header ── */}
      <View className="pt-14 pb-2 px-5 bg-white dark:bg-zinc-900 border-b border-neutral-200 dark:border-zinc-800">
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-3">
            <Sparkles size={22} color="#58a6ff" />
            <Text className="text-black dark:text-white text-xl font-bold tracking-tight">
              Smart Search
            </Text>
          </View>
          {aiEnabled && (
            <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800/40">
              <Sparkles size={10} color="#a855f7" />
              <Text className="text-purple-700 dark:text-purple-300 text-[10px] font-bold">AI ON</Text>
            </View>
          )}
        </View>

        {/* Search input */}
        <View className="flex-row items-center bg-neutral-100 dark:bg-black rounded-xl border border-neutral-200 dark:border-zinc-800 px-4 py-0">
          <Search size={18} color="#8b949e" />
          <TextInput
            className="flex-1 text-black dark:text-neutral-100 text-sm py-3 px-3"
            placeholder='Try "bug fixes last week" or "who modified auth"'
            placeholderTextColor="#8b949e"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => handleSearch()}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={clearSearch} className="p-1">
              <X size={16} color="#8b949e" />
            </TouchableOpacity>
          )}
        </View>

        {/* Repo selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3 -mx-1"
        >
          <View className="flex-row gap-2 px-1 pb-2">
            <TouchableOpacity
              className={`px-3.5 py-1.5 rounded-lg border ${
                selectedRepo === null
                  ? 'bg-[#1f6feb]/10 border-[#1f6feb]/40'
                  : 'bg-white dark:bg-zinc-900 border-neutral-200 dark:border-zinc-800'
              }`}
              onPress={() => setSelectedRepo(null)}
            >
              <Text
                className={`text-xs font-semibold ${
                  selectedRepo === null
                    ? 'text-[#58a6ff]'
                    : 'text-neutral-500'
                }`}
              >
                All Repos
              </Text>
            </TouchableOpacity>
            {repos.map((r) => (
              <TouchableOpacity
                key={r.name}
                className={`px-3.5 py-1.5 rounded-lg border ${
                  selectedRepo === r.name
                    ? 'bg-[#1f6feb]/10 border-[#1f6feb]/40'
                    : 'bg-white dark:bg-zinc-900 border-neutral-200 dark:border-zinc-800'
                }`}
                onPress={() =>
                  setSelectedRepo(selectedRepo === r.name ? null : r.name)
                }
              >
                <Text
                  className={`text-xs font-semibold ${
                    selectedRepo === r.name
                      ? 'text-[#58a6ff]'
                      : 'text-neutral-500'
                  }`}
                >
                  {r.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Parsed filter preview ── */}
        {parsedFilters && query.length >= 3 && !hasSearched && (
          <View className="mx-5 mt-4 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
            <Text className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-2.5">
              Detected Filters
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {parsedFilters.authors.length > 0 &&
                parsedFilters.authors.map((a: string) => (
                  <View
                    key={a}
                    className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/40"
                  >
                    <User size={11} color="#a855f7" />
                    <Text className="text-purple-700 dark:text-purple-300 text-[11px] font-semibold">
                      {a}
                    </Text>
                  </View>
                ))}
              {parsedFilters.files.length > 0 &&
                parsedFilters.files.map((f: string) => (
                  <View
                    key={f}
                    className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40"
                  >
                    <FileCode size={11} color="#3b82f6" />
                    <Text className="text-blue-700 dark:text-blue-300 text-[11px] font-semibold">
                      {f}
                    </Text>
                  </View>
                ))}
              {parsedFilters.dateRange && (
                <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40">
                  <CalendarDays size={11} color="#22c55e" />
                  <Text className="text-green-700 dark:text-green-300 text-[11px] font-semibold">
                    {parsedFilters.dateRange.since
                      ? `since ${formatDate(parsedFilters.dateRange.since)}`
                      : 'custom range'}
                  </Text>
                </View>
              )}
              {parsedFilters.type && (
                <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40">
                  <Tag size={11} color="#f59e0b" />
                  <Text className="text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
                    {parsedFilters.type}
                  </Text>
                </View>
              )}
              {parsedFilters.keywords.length > 0 &&
                parsedFilters.keywords.map((kw: string) => (
                  <View
                    key={kw}
                    className="px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-zinc-800 border border-neutral-200 dark:border-zinc-700"
                  >
                    <Text className="text-neutral-600 dark:text-neutral-300 text-[11px] font-semibold">
                      "{kw}"
                    </Text>
                  </View>
                ))}
            </View>
            <TouchableOpacity
              className="mt-3 py-2.5 rounded-lg bg-[#1f6feb] items-center flex-row justify-center gap-2"
              onPress={() => handleSearch()}
            >
              <Search size={14} color="#fff" />
              <Text className="text-white text-sm font-bold">Search</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Searching state ── */}
        {searching && (
          <View className="mt-12 items-center">
            <ActivityIndicator color="#58a6ff" size="large" />
            <Text className="text-neutral-500 text-sm font-medium mt-3">
              Searching commits...
            </Text>
          </View>
        )}

        {/* ── Results ── */}
        {hasSearched && !searching && (
          <View className="mt-4 px-5">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider">
                {results.length} result{results.length !== 1 ? 's' : ''} found
              </Text>
              <Text className="text-neutral-400 text-[10px] font-medium">
                {aiEnabled ? '✨ AI-powered' : 'ranked by relevance'}
              </Text>
            </View>

            {/* AI Intent + Summary card */}
            {(aiIntent || aiSummary || loadingSummary) && (
              <View className="mb-4 p-4 rounded-xl bg-gradient-to-r border border-purple-200 dark:border-purple-800/40 bg-purple-50 dark:bg-purple-900/20">
                <View className="flex-row items-center gap-2 mb-2">
                  <Sparkles size={13} color="#a855f7" />
                  <Text className="text-purple-700 dark:text-purple-300 text-[11px] font-bold uppercase tracking-wider">
                    AI Insight
                  </Text>
                </View>
                {aiIntent && (
                  <Text className="text-purple-900 dark:text-purple-200 text-sm font-semibold mb-1">
                    {aiIntent}
                  </Text>
                )}
                {loadingSummary && !aiSummary && (
                  <View className="flex-row items-center gap-2 mt-1">
                    <ActivityIndicator size="small" color="#a855f7" />
                    <Text className="text-purple-400 text-xs">Generating summary...</Text>
                  </View>
                )}
                {aiSummary && (
                  <Text className="text-purple-800 dark:text-purple-300 text-[13px] leading-relaxed mt-1">
                    {aiSummary}
                  </Text>
                )}
              </View>
            )}

            {results.length === 0 ? (
              <View className="items-center py-12 bg-white dark:bg-zinc-900 rounded-xl border border-neutral-200 dark:border-zinc-800">
                <Text className="text-3xl mb-3">🔍</Text>
                <Text className="text-neutral-500 text-sm font-medium">
                  No matching commits found
                </Text>
                <Text className="text-neutral-400 text-xs mt-1">
                  Try a different query or broader date range
                </Text>
              </View>
            ) : (
              <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
                {results.map((r, idx) => (
                  <TouchableOpacity
                    key={`${r.repo}-${r.oid}`}
                    className={`px-4 py-3.5 ${
                      idx < results.length - 1
                        ? 'border-b border-neutral-100 dark:border-zinc-800'
                        : ''
                    }`}
                    onPress={() =>
                      router.push({
                        pathname: '/repo/[name]' as any,
                        params: { name: r.repo },
                      })
                    }
                    activeOpacity={0.7}
                  >
                    <View className="flex-row items-start gap-3">
                      {/* Commit icon with score indicator */}
                      <View
                        className={`w-8 h-8 rounded-full items-center justify-center mt-0.5 ${
                          r.score >= 30
                            ? 'bg-[#1f6feb]/15'
                            : r.score >= 15
                              ? 'bg-[#238636]/15'
                              : 'bg-neutral-100 dark:bg-zinc-800'
                        }`}
                      >
                        <GitCommitVertical
                          size={15}
                          color={
                            r.score >= 30
                              ? '#58a6ff'
                              : r.score >= 15
                                ? '#7ee787'
                                : '#8b949e'
                          }
                        />
                      </View>

                      <View className="flex-1">
                        {/* Commit message */}
                        <Text
                          className="text-black dark:text-neutral-100 text-[13px] font-semibold leading-tight"
                          numberOfLines={2}
                        >
                          {r.message.trim()}
                        </Text>

                        {/* Meta row */}
                        <View className="flex-row items-center gap-2 mt-1.5 flex-wrap">
                          <Text className="text-neutral-400 text-[11px] font-mono">
                            {r.shortOid}
                          </Text>
                          <Text className="text-neutral-300 dark:text-zinc-700">
                            ·
                          </Text>
                          <Text className="text-neutral-500 text-[11px] font-medium">
                            {r.author}
                          </Text>
                          <Text className="text-neutral-300 dark:text-zinc-700">
                            ·
                          </Text>
                          <Text className="text-neutral-400 text-[11px]">
                            {timeAgo(r.timestamp)}
                          </Text>
                          {selectedRepo === null && (
                            <>
                              <Text className="text-neutral-300 dark:text-zinc-700">
                                ·
                              </Text>
                              <Text className="text-[#58a6ff] text-[11px] font-semibold">
                                {r.repo}
                              </Text>
                            </>
                          )}
                        </View>

                        {/* Match reason tags */}
                        {r.matchReasons.length > 0 && (
                          <View className="flex-row flex-wrap gap-1.5 mt-2">
                            {[...new Set(r.matchReasons)].slice(0, 4).map((reason, i) => (
                              <View
                                key={i}
                                className="px-2 py-0.5 rounded bg-[#1f6feb]/10 border border-[#1f6feb]/20"
                              >
                                <Text className="text-[#58a6ff] text-[10px] font-semibold">
                                  {reason}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>

                      <ChevronRight
                        size={14}
                        color="#8b949e"
                        style={{ marginTop: 4 }}
                      />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Suggestions (when no search yet) ── */}
        {!hasSearched && !searching && query.length < 3 && (
          <View className="mt-4 px-5">
            {/* Recent queries */}
            {recentQueries.length > 0 && (
              <View className="mb-5">
                <Text className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-3 ml-1">
                  Recent Searches
                </Text>
                <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
                  {recentQueries.map((rq, idx) => (
                    <TouchableOpacity
                      key={idx}
                      className={`flex-row items-center gap-3 px-4 py-3 ${
                        idx < recentQueries.length - 1
                          ? 'border-b border-neutral-100 dark:border-zinc-800'
                          : ''
                      }`}
                      onPress={() => {
                        setQuery(rq)
                        handleSearch(rq)
                      }}
                    >
                      <Clock size={14} color="#8b949e" />
                      <Text className="text-black dark:text-neutral-200 text-sm font-medium flex-1">
                        {rq}
                      </Text>
                      <ArrowRight size={12} color="#8b949e" />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Suggested queries */}
            <Text className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-3 ml-1">
              Try These
            </Text>
            <View className="rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 overflow-hidden">
              {SUGGESTED_QUERIES.map((s, idx) => (
                <TouchableOpacity
                  key={idx}
                  className={`flex-row items-center gap-3 px-4 py-3.5 ${
                    idx < SUGGESTED_QUERIES.length - 1
                      ? 'border-b border-neutral-100 dark:border-zinc-800'
                      : ''
                  }`}
                  onPress={() => {
                    setQuery(s.text)
                    handleSearch(s.text)
                  }}
                >
                  <Text className="text-base">{s.icon}</Text>
                  <Text className="text-black dark:text-neutral-200 text-sm font-medium flex-1">
                    {s.text}
                  </Text>
                  <ArrowRight size={12} color="#8b949e" />
                </TouchableOpacity>
              ))}
            </View>

            {/* How it works */}
            <View className="mt-5 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
              <View className="flex-row items-center gap-2 mb-3">
                <Sparkles size={14} color="#f78166" />
                <Text className="text-black dark:text-neutral-100 text-sm font-bold">
                  How Smart Search Works
                </Text>
              </View>
              <Text className="text-neutral-500 text-xs leading-relaxed">
                Type a natural language query and Smart Search will understand your
                intent. It extracts{' '}
                <Text className="text-purple-500 font-semibold">authors</Text>,{' '}
                <Text className="text-blue-500 font-semibold">file names</Text>,{' '}
                <Text className="text-green-500 font-semibold">time ranges</Text>,
                and{' '}
                <Text className="text-amber-500 font-semibold">
                  commit types
                </Text>{' '}
                from your query, then ranks results by relevance.
              </Text>
              <View className="mt-3 flex-col gap-1.5">
                <Text className="text-neutral-400 text-[11px] font-mono">
                  💡 "bug fixes by John last week"
                </Text>
                <Text className="text-neutral-400 text-[11px] font-mono">
                  💡 "who modified App.tsx"
                </Text>
                <Text className="text-neutral-400 text-[11px] font-mono">
                  💡 "new features this month"
                </Text>
                <Text className="text-neutral-400 text-[11px] font-mono">
                  💡 "refactoring changes to services"
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
