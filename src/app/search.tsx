import { useCallback, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Animated,
} from 'react-native'
import { useColorScheme } from 'nativewind'
import { useFocusEffect, useRouter } from 'expo-router'
import {
  Search,
  Clock,
  GitCommitVertical,
  Sparkles,
  X,
  ChevronRight,
  User,
  ArrowRight,
  Zap,
  GitBranch,
  FileCode,
  Calendar,
} from 'lucide-react-native'

import { listRepos } from '@/services/repoService'
import {
  searchCommits,
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

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = [
  '#58a6ff', '#7ee787', '#d2a8ff', '#ffa657', '#ff7b72',
  '#79c0ff', '#f2cc60', '#56d364',
]
function avatarColor(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

type SearchResult = {
  repo: string; oid: string; shortOid: string
  message: string; author: string; email: string
  timestamp: number; score: number; matchReasons: string[]
}
type Repo = { name: string; path: string; isGitRepo: boolean }

/* ── Category filters ── */
const CATEGORIES = [
  { id: 'all',      label: 'All',      icon: Zap },
  { id: 'fixes',    label: 'Fixes',    icon: Sparkles },
  { id: 'features', label: 'Features', icon: GitBranch },
  { id: 'files',    label: 'Files',    icon: FileCode },
  { id: 'author',   label: 'Author',   icon: User },
  { id: 'date',     label: 'Date',     icon: Calendar },
]

/* ═══════════ COMPONENT ═══════════ */
export default function SearchScreen() {
  const { colorScheme } = useColorScheme()
  const isDark = colorScheme === 'dark'
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [repos, setRepos] = useState<Repo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const [aiIntent, setAiIntent] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState('all')
  const [inputFocused, setInputFocused] = useState(false)
  const aiEnabled = isAIAvailable()

  const fadeAnim = useRef(new Animated.Value(0)).current

  useFocusEffect(
    useCallback(() => {
      listRepos().then((r) => setRepos(r.filter((x: Repo) => x.isGitRepo !== false)))
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start()
    }, []),
  )

  const handleSearch = useCallback(
    async (q?: string) => {
      const searchQuery = (q ?? query).trim()
      if (!searchQuery) return
      Keyboard.dismiss()
      setSearching(true)
      setHasSearched(true)
      setAiIntent(null)
      setAiSummary(null)

      try {
        // @ts-ignore
        const response = await searchCommits(searchQuery, selectedRepo)
        const resultItems = Array.isArray(response) ? response : (response?.results ?? [])
        const intent = Array.isArray(response) ? null : (response?.aiIntent ?? null)
        setResults(resultItems)
        setAiIntent(intent)
        setRecentQueries((prev) => {
          const next = [searchQuery, ...prev.filter((x) => x !== searchQuery)]
          return next.slice(0, 8)
        })
      } catch {
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
    setActiveCategory('all')
  }, [])

  /* filter results by category */
  const filteredResults = useMemo(() => {
    if (activeCategory === 'all') return results
    const map: Record<string, string[]> = {
      fixes:    ['fix', 'bug', 'patch', 'hotfix'],
      features: ['feat', 'feature', 'add', 'new'],
      files:    ['file', 'refactor', 'move', 'rename'],
      author:   [],
      date:     [],
    }
    const kws = map[activeCategory] ?? []
    if (kws.length === 0) return results
    return results.filter((r) =>
      kws.some((kw) => r.message.toLowerCase().includes(kw)),
    )
  }, [results, activeCategory])

  /* ═══ RENDER ═══ */
  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#000000' : '#ffffff' }}>

      {/* ─── Header ─── */}
      <View
        style={{
          paddingTop: 16,
          paddingBottom: 16,
          paddingHorizontal: 20,
          backgroundColor: isDark ? '#000000' : '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: isDark ? '#111111' : '#f5f5f5',
        }}
      >
        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: '#58a6ff18',
              borderWidth: 1,
              borderColor: '#58a6ff33',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
            }}
          >
            <Sparkles size={18} color="#58a6ff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: isDark ? '#e6edf3' : '#000000', fontSize: 20, fontWeight: '700', letterSpacing: -0.5 }}>
              Smart Search
            </Text>
            <Text style={{ color: isDark ? '#484f58' : '#737373', fontSize: 11, marginTop: 1 }}>
              Natural language · AI-powered
            </Text>
          </View>
          {aiEnabled && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 20,
                backgroundColor: '#d2a8ff18',
                borderWidth: 1,
                borderColor: '#d2a8ff33',
              }}
            >
              <Sparkles size={10} color="#d2a8ff" />
              <Text style={{ color: '#d2a8ff', fontSize: 10, fontWeight: '800' }}>AI ON</Text>
            </View>
          )}
        </View>

        {/* Search bar */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: inputFocused ? '#58a6ff' : isDark ? '#222222' : '#d4d4d4',
            paddingHorizontal: 14,
            height: 48,
          }}
        >
          <Search size={18} color={inputFocused ? '#58a6ff' : isDark ? '#484f58' : '#737373'} />
          <TextInput
            style={{
              flex: 1,
              color: isDark ? '#e6edf3' : '#000000',
              fontSize: 14,
              marginHorizontal: 10,
              height: '100%',
            }}
            placeholder="bug fixes last week · who touched auth.ts"
            placeholderTextColor="#333333"
            value={query}
            onChangeText={setQuery}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onSubmitEditing={() => handleSearch()}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={clearSearch} style={{ padding: 4 }}>
              <X size={16} color="#484f58" />
            </TouchableOpacity>
          ) : (
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 6,
                backgroundColor: isDark ? '#1a1a1a' : '#e5e5e5',
                borderWidth: 1,
                borderColor: isDark ? '#222' : '#d4d4d4',
              }}
            >
              <Text style={{ color: isDark ? '#484f58' : '#737373', fontSize: 10, fontWeight: '600' }}>↵</Text>
            </View>
          )}
        </View>

        {/* Repo chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12 }}
          contentContainerStyle={{ gap: 8, paddingRight: 4 }}
        >
          {[{ name: 'All Repos' }, ...repos].map((r, i) => {
            const isSelected = i === 0 ? selectedRepo === null : selectedRepo === r.name
            return (
              <TouchableOpacity
                key={r.name}
                onPress={() => setSelectedRepo(i === 0 ? null : r.name)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 20,
                  backgroundColor: isSelected ? '#58a6ff18' : isDark ? '#0a0a0a' : '#fafafa',
                  borderWidth: 1,
                  borderColor: isSelected ? '#58a6ff55' : isDark ? '#1a1a1a' : '#e5e5e5',
                }}
              >
                <Text
                  style={{
                    color: isSelected ? '#58a6ff' : isDark ? '#484f58' : '#737373',
                    fontSize: 12,
                    fontWeight: isSelected ? '700' : '500',
                  }}
                >
                  {r.name}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Searching ── */}
        {searching && (
          <View style={{ marginTop: 60, alignItems: 'center', gap: 12 }}>
            <ActivityIndicator color="#58a6ff" size="large" />
            <Text style={{ color: isDark ? '#484f58' : '#737373', fontSize: 13 }}>Searching commits…</Text>
          </View>
        )}

        {/* ── Results ── */}
        {hasSearched && !searching && (
          <Animated.View style={{ opacity: fadeAnim, marginTop: 20, paddingHorizontal: 16 }}>

            {/* Result count + AI badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 20,
                  backgroundColor: '#58a6ff15',
                  borderWidth: 1,
                  borderColor: '#58a6ff30',
                }}
              >
                <Text style={{ color: '#58a6ff', fontSize: 11, fontWeight: '700' }}>
                  {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}
                </Text>
              </View>
              {aiEnabled && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={10} color="#d2a8ff" />
                  <Text style={{ color: isDark ? '#484f58' : '#737373', fontSize: 11 }}>AI-ranked</Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              <Text style={{ color: isDark ? '#333333' : '#a3a3a3', fontSize: 11 }}>"{query}"</Text>
            </View>

            {/* AI Intent card */}
            {aiIntent && (
              <View
                style={{
                  marginBottom: 14,
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: '#d2a8ff0d',
                  borderWidth: 1,
                  borderColor: '#d2a8ff22',
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <Sparkles size={14} color="#d2a8ff" style={{ marginTop: 1 }} />
                <Text style={{ color: '#d2a8ff', fontSize: 12, flex: 1, lineHeight: 18 }}>
                  {aiIntent}
                </Text>
              </View>
            )}

            {/* Category filter tabs */}
            {results.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 14 }}
                contentContainerStyle={{ gap: 6 }}
              >
                {CATEGORIES.map((cat) => {
                  const isActive = activeCategory === cat.id
                  const CatIcon = cat.icon
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      onPress={() => setActiveCategory(cat.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 20,
                        backgroundColor: isActive ? '#58a6ff' : isDark ? '#0a0a0a' : '#fafafa',
                        borderWidth: 1,
                        borderColor: isActive ? '#58a6ff' : isDark ? '#1a1a1a' : '#e5e5e5',
                      }}
                    >
                      <CatIcon size={11} color={isActive ? '#fff' : isDark ? '#484f58' : '#737373'} />
                      <Text
                        style={{
                          color: isActive ? '#fff' : isDark ? '#484f58' : '#737373',
                          fontSize: 12,
                          fontWeight: isActive ? '700' : '500',
                        }}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            )}

            {/* Empty state */}
            {filteredResults.length === 0 ? (
              <View
                style={{
                  alignItems: 'center',
                  paddingVertical: 48,
                  backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: isDark ? '#1a1a1a' : '#e5e5e5',
                }}
              >
                <Search size={36} color="#484f58" style={{ marginBottom: 12 }} />
                <Text style={{ color: isDark ? '#8b949e' : '#737373', fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
                  No commits found
                </Text>
                <Text style={{ color: isDark ? '#333333' : '#a3a3a3', fontSize: 12, textAlign: 'center', maxWidth: 220 }}>
                  Try a broader query or select a different repo
                </Text>
              </View>
            ) : (
              <View
                style={{
                  backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: isDark ? '#1a1a1a' : '#e5e5e5',
                  overflow: 'hidden',
                }}
              >
                {filteredResults.map((r, idx) => {
                  const col = avatarColor(r.author)
                  const isLast = idx === filteredResults.length - 1
                  const relevance = Math.min(100, Math.round((r.score / 40) * 100))
                  return (
                    <TouchableOpacity
                      key={`${r.repo}-${r.oid}`}
                      onPress={() =>
                        router.push({ pathname: '/repo/[name]' as any, params: { name: r.repo } })
                      }
                      activeOpacity={0.7}
                      style={{
                        padding: 16,
                        borderBottomWidth: isLast ? 0 : 1,
                        borderBottomColor: isDark ? '#111111' : '#f5f5f5',
                      }}
                    >
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        {/* Avatar */}
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: col + '20',
                            borderWidth: 1.5,
                            borderColor: col + '44',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Text style={{ color: col, fontSize: 11, fontWeight: '800' }}>
                            {initials(r.author)}
                          </Text>
                        </View>

                        <View style={{ flex: 1 }}>
                          {/* Commit message */}
                          <Text
                            style={{
                              color: isDark ? '#e6edf3' : '#000000',
                              fontSize: 13,
                              fontWeight: '600',
                              lineHeight: 19,
                              marginBottom: 6,
                            }}
                            numberOfLines={2}
                          >
                            {r.message.trim()}
                          </Text>

                          {/* Meta row */}
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                            <Text
                              style={{
                                color: '#58a6ff',
                                fontSize: 11,
                                fontFamily: 'monospace',
                                fontWeight: '600',
                              }}
                            >
                              {r.shortOid}
                            </Text>
                            <Text style={{ color: isDark ? '#1a1a1a' : '#e5e5e5' }}>·</Text>
                            <Text style={{ color: isDark ? '#484f58' : '#737373', fontSize: 11 }}>{r.author}</Text>
                            <Text style={{ color: isDark ? '#1a1a1a' : '#e5e5e5' }}>·</Text>
                            <Text style={{ color: isDark ? '#333333' : '#a3a3a3', fontSize: 11 }}>{timeAgo(r.timestamp)}</Text>
                            {selectedRepo === null && (
                              <>
                                <Text style={{ color: isDark ? '#1a1a1a' : '#e5e5e5' }}>·</Text>
                                <View
                                  style={{
                                    paddingHorizontal: 6,
                                    paddingVertical: 2,
                                    borderRadius: 4,
                                    backgroundColor: '#58a6ff12',
                                    borderWidth: 1,
                                    borderColor: '#58a6ff25',
                                  }}
                                >
                                  <Text style={{ color: '#58a6ff', fontSize: 10, fontWeight: '600' }}>
                                    {r.repo}
                                  </Text>
                                </View>
                              </>
                            )}
                          </View>

                          {/* Relevance bar */}
                          {r.score > 0 && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <View
                                style={{
                                  flex: 1,
                                  height: 3,
                                  borderRadius: 2,
                                  backgroundColor: isDark ? '#111111' : '#f5f5f5',
                                }}
                              >
                                <View
                                  style={{
                                    width: `${relevance}%`,
                                    height: 3,
                                    borderRadius: 2,
                                    backgroundColor:
                                      relevance >= 70
                                        ? '#7ee787'
                                        : relevance >= 40
                                          ? '#58a6ff'
                                          : isDark ? '#484f58' : '#737373',
                                  }}
                                />
                              </View>
                              <Text style={{ color: isDark ? '#333333' : '#a3a3a3', fontSize: 10 }}>{relevance}%</Text>
                            </View>
                          )}

                          {/* Match reason tags */}
                          {r.matchReasons.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                              {[...new Set(r.matchReasons)].slice(0, 4).map((reason, i) => (
                                <View
                                  key={i}
                                  style={{
                                    paddingHorizontal: 7,
                                    paddingVertical: 2,
                                    borderRadius: 4,
                                    backgroundColor: '#1f6feb12',
                                    borderWidth: 1,
                                    borderColor: '#1f6feb25',
                                  }}
                                >
                                  <Text style={{ color: '#58a6ff', fontSize: 10, fontWeight: '600' }}>
                                    {reason}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}
                        </View>

                        <ChevronRight size={14} color="#222222" style={{ marginTop: 10 }} />
                      </View>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}
          </Animated.View>
        )}

        {/* ── Pre-search state ── */}
        {!hasSearched && !searching && (
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>

            {/* Recent searches */}
            {recentQueries.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <Text
                  style={{
                    color: isDark ? '#333333' : '#a3a3a3',
                    fontSize: 10,
                    fontWeight: '800',
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                    marginBottom: 10,
                    marginLeft: 4,
                  }}
                >
                  Recent
                </Text>
                <View
                  style={{
                    backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: isDark ? '#1a1a1a' : '#e5e5e5',
                    overflow: 'hidden',
                  }}
                >
                  {recentQueries.map((rq, idx) => (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => { setQuery(rq); handleSearch(rq) }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 13,
                        borderBottomWidth: idx < recentQueries.length - 1 ? 1 : 0,
                        borderBottomColor: isDark ? '#111111' : '#f5f5f5',
                      }}
                    >
                      <Clock size={14} color="#333333" />
                      <Text style={{ color: isDark ? '#8b949e' : '#737373', fontSize: 13, flex: 1 }}>{rq}</Text>
                      <ArrowRight size={13} color="#1a1a1a" />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Suggested queries — grid of chips */}
            <Text
              style={{
                color: isDark ? '#333333' : '#a3a3a3',
                fontSize: 10,
                fontWeight: '800',
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                marginBottom: 10,
                marginLeft: 4,
              }}
            >
              Try These
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {SUGGESTED_QUERIES.map((s: any, idx: number) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => { setQuery(s.text); handleSearch(s.text) }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 20,
                    backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
                    borderWidth: 1,
                    borderColor: isDark ? '#1a1a1a' : '#e5e5e5',
                  }}
                >
                  <Text style={{ color: isDark ? '#8b949e' : '#737373', fontSize: 12, fontWeight: '500' }}>{s.text}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* How it works — compact pills */}
            <View
              style={{
                padding: 16,
                borderRadius: 14,
                backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
                borderWidth: 1,
                borderColor: isDark ? '#1a1a1a' : '#e5e5e5',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Sparkles size={14} color="#58a6ff" />
                <Text style={{ color: isDark ? '#e6edf3' : '#000000', fontSize: 13, fontWeight: '700' }}>
                  How Smart Search Works
                </Text>
              </View>
              <Text style={{ color: isDark ? '#484f58' : '#737373', fontSize: 12, lineHeight: 19, marginBottom: 12 }}>
                Type naturally — it understands{' '}
                <Text style={{ color: '#d2a8ff', fontWeight: '600' }}>authors</Text>,{' '}
                <Text style={{ color: '#58a6ff', fontWeight: '600' }}>file names</Text>,{' '}
                <Text style={{ color: '#7ee787', fontWeight: '600' }}>time ranges</Text> and{' '}
                <Text style={{ color: '#ffa657', fontWeight: '600' }}>commit types</Text>.
              </Text>
              <View style={{ gap: 6 }}>
                {[
                  '"bug fixes by John last week"',
                  '"who modified App.tsx"',
                  '"new features this month"',
                  '"refactoring in services/"',
                ].map((tip, i) => (
                  <View
                    key={i}
                    style={{
                      backgroundColor: isDark ? '#111111' : '#f5f5f5',
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                    }}
                  >
                    <Text style={{ color: isDark ? '#484f58' : '#737373', fontSize: 11, fontFamily: 'monospace' }}>
                      {tip}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
