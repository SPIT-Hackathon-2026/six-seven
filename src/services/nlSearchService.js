/**
 * nlSearchService.js
 *
 * Natural-language commit search engine.
 * Parses human queries like "who modified login.tsx last week"
 * into structured filters, then searches the git log across repos.
 *
 * No LLM required — uses pattern matching and smart keyword extraction.
 */

import { getLog, diffSummary } from './gitService'
import { listRepos } from './repoService'
import { aiParseQuery, aiSummarizeResults, isAIAvailable } from './aiService'

// Re-export AI functions for the UI
export { aiSummarizeResults, isAIAvailable }

// =====================================================================
//  QUERY PARSER — Natural Language → Structured Filters
// =====================================================================

/**
 * Parse a natural-language query into structured search filters.
 * Returns { authors, files, keywords, dateRange, repo, type }
 */
export function parseQuery(query) {
  const q = query.trim().toLowerCase()
  const filters = {
    authors: [],
    files: [],
    keywords: [],
    dateRange: null,   // { since, until } as ms timestamps
    repo: null,
    type: null,
    limit: 50,
  }

  let remaining = q

  // ── Author extraction ──────────────────────────────────────────

  const authorPatterns = [
    /(?:by|from|author)\s+["']?([a-z0-9_.\-@\s]+?)["']?(?:\s+(?:in|on|to|since|last|this|yesterday|today|before|after|about|regarding)|$)/i,
  ]
  for (const re of authorPatterns) {
    const m = remaining.match(re)
    if (m && m[1]) {
      filters.authors.push(m[1].trim())
      remaining = remaining.replace(m[0], ' ')
    }
  }

  // ── File / path extraction ─────────────────────────────────────

  const filePatterns = [
    /(?:in|to|on|for|file|modif(?:y|ied)|chang(?:e|ed|es)|touch(?:ed)?|updat(?:e|ed))\s+["']?([a-z0-9_.\-/]+\.[a-z]{1,5})["']?/gi,
    /["']([a-z0-9_.\-/]+\.[a-z]{1,5})["']/gi,
    /(?:^|\s)([a-z0-9_\-]+\.[a-z]{2,5})(?:\s|$)/gi,
  ]
  for (const re of filePatterns) {
    let m
    while ((m = re.exec(remaining)) !== null) {
      if (m[1] && !['ago', 'com'].includes(m[1])) {
        filters.files.push(m[1].trim())
      }
    }
  }

  // folder patterns: "changes to auth", "in src/utils"
  const folderPattern = /(?:changes?\s+(?:to|in)|in\s+(?:the\s+)?(?:folder|dir|directory|module|package)?)\s+["']?([a-z0-9_.\-/]+)["']?/gi
  let fm
  while ((fm = folderPattern.exec(remaining)) !== null) {
    if (fm[1] && fm[1].length > 1 && !isTimeWord(fm[1])) {
      filters.files.push(fm[1].trim())
    }
  }

  // ── Date range extraction ──────────────────────────────────────

  const now = Date.now()
  const DAY = 86400000
  const WEEK = 7 * DAY
  const MONTH = 30 * DAY

  // "last week", "last month", "last 3 days"
  const lastMatch = remaining.match(/last\s+(\d+\s+)?(?:day|week|month|year)s?/i)
  if (lastMatch) {
    const full = lastMatch[0]
    const num = lastMatch[1] ? parseInt(lastMatch[1]) : 1
    if (full.includes('day'))        filters.dateRange = { since: now - num * DAY }
    else if (full.includes('week'))  filters.dateRange = { since: now - num * WEEK }
    else if (full.includes('month')) filters.dateRange = { since: now - num * MONTH }
    else if (full.includes('year'))  filters.dateRange = { since: now - num * 365 * DAY }
    remaining = remaining.replace(full, ' ')
  }

  // "today"
  if (/\btoday\b/.test(remaining)) {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    filters.dateRange = { since: startOfDay.getTime() }
    remaining = remaining.replace(/\btoday\b/, ' ')
  }

  // "yesterday"
  if (/\byesterday\b/.test(remaining)) {
    const startYesterday = new Date()
    startYesterday.setDate(startYesterday.getDate() - 1)
    startYesterday.setHours(0, 0, 0, 0)
    const endYesterday = new Date()
    endYesterday.setHours(0, 0, 0, 0)
    filters.dateRange = { since: startYesterday.getTime(), until: endYesterday.getTime() }
    remaining = remaining.replace(/\byesterday\b/, ' ')
  }

  // "this week", "this month"
  const thisMatch = remaining.match(/this\s+(week|month|year)/i)
  if (thisMatch) {
    const unit = thisMatch[1]
    const start = new Date()
    if (unit === 'week') start.setDate(start.getDate() - start.getDay())
    else if (unit === 'month') start.setDate(1)
    else if (unit === 'year') { start.setMonth(0); start.setDate(1) }
    start.setHours(0, 0, 0, 0)
    filters.dateRange = { since: start.getTime() }
    remaining = remaining.replace(thisMatch[0], ' ')
  }

  // "recently" → last 2 weeks
  if (/\brecently?\b/.test(remaining)) {
    if (!filters.dateRange) {
      filters.dateRange = { since: now - 2 * WEEK }
    }
    remaining = remaining.replace(/\brecently?\b/, ' ')
  }

  // ── Commit type extraction ─────────────────────────────────────

  const typeMap = {
    bug: /\b(?:bug|bugs|bugfix|fix|fixes|fixed|hotfix|patch)\b/,
    feature: /\b(?:feature|features|feat|add|adds|added|new|implement|implemented)\b/,
    refactor: /\b(?:refactor|refactored|refactoring|cleanup|clean.?up|restructure)\b/,
    docs: /\b(?:docs|documentation|readme|comment|comments)\b/,
    style: /\b(?:style|styling|css|ui|design|layout)\b/,
    test: /\b(?:test|tests|testing|spec|specs)\b/,
    chore: /\b(?:chore|deps|dependency|dependencies|upgrade|bump|version)\b/,
  }
  for (const [type, re] of Object.entries(typeMap)) {
    if (re.test(remaining)) {
      filters.type = type
      break
    }
  }

  // ── Remaining keywords ─────────────────────────────────────────

  const stopWords = new Set([
    'show', 'me', 'the', 'all', 'find', 'search', 'for', 'get', 'list',
    'what', 'which', 'where', 'when', 'who', 'how', 'did', 'does', 'do',
    'is', 'are', 'was', 'were', 'has', 'have', 'had', 'been', 'being',
    'a', 'an', 'of', 'in', 'on', 'at', 'to', 'with', 'from', 'by',
    'about', 'like', 'that', 'this', 'it', 'its', 'and', 'or', 'but',
    'not', 'no', 'so', 'if', 'any', 'my', 'our', 'their', 'his', 'her',
    'changes', 'changed', 'change', 'commits', 'commit', 'committed',
    'modified', 'modify', 'modifications', 'recent', 'latest',
    'since', 'before', 'after', 'during', 'between', 'related',
  ])

  const words = remaining
    .replace(/[^\w\s.-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w))

  filters.keywords = [...new Set(words)]

  return filters
}

// =====================================================================
//  SEARCH ENGINE — search commits using parsed filters
// =====================================================================

/**
 * Search commits across one or all repos using a natural-language query.
 */
export async function searchCommits(query, repoName = null) {
  // Try AI parsing first, fall back to regex
  let filters = null
  let aiIntent = null

  if (isAIAvailable()) {
    try {
      const aiResult = await aiParseQuery(query)
      if (aiResult) {
        // Merge AI result with our expected shape
        filters = {
          authors: aiResult.authors || [],
          files: aiResult.files || [],
          keywords: aiResult.keywords || [],
          dateRange: aiResult.dateRange || null,
          repo: aiResult.repo || null,
          type: aiResult.type || null,
          limit: 50,
        }
        aiIntent = aiResult.intent || null
      }
    } catch {
      // Fall through to regex parser
    }
  }

  // Fallback to regex parser
  if (!filters) {
    filters = parseQuery(query)
  }

  // Determine which repos to search
  let repos
  if (repoName) {
    repos = [{ name: repoName }]
  } else {
    const allRepos = await listRepos()
    repos = allRepos.filter((r) => r.isGitRepo === true)
  }

  // If no git repos at all, return empty
  if (repos.length === 0) return { results: [], aiIntent: null, aiAvailable: isAIAvailable() }

  const hasAnyFilter = (
    filters.dateRange ||
    filters.authors.length > 0 ||
    filters.files.length > 0 ||
    filters.type ||
    filters.keywords.length > 0
  )

  const results = []

  for (const repo of repos) {
    try {
      let log
      try {
        log = await getLog(repo.name, { depth: 100 })
      } catch {
        // Repo has no commits or HEAD doesn't resolve — skip silently
        continue
      }
      if (!log || !Array.isArray(log) || log.length === 0) continue

      for (const entry of log) {
        // Normalize commit object (isomorphic-git format)
        const message = entry.commit?.message ?? entry.message ?? ''
        const author = entry.commit?.author?.name ?? entry.author ?? 'Unknown'
        const email = entry.commit?.author?.email ?? entry.email ?? ''
        // isomorphic-git timestamps are in SECONDS, convert to ms
        const rawTs = entry.commit?.author?.timestamp ?? entry.timestamp ?? 0
        const timestampMs = rawTs > 1e12 ? rawTs : rawTs * 1000

        const commit = {
          repo: repo.name,
          oid: entry.oid,
          shortOid: entry.oid.slice(0, 7),
          message,
          author,
          email,
          timestamp: timestampMs,
          score: 0,
          matchReasons: [],
        }

        // ── Score against filters ─────────────────────────────

        // Date filter — skip commits outside range
        if (filters.dateRange) {
          if (filters.dateRange.since && commit.timestamp < filters.dateRange.since) continue
          if (filters.dateRange.until && commit.timestamp > filters.dateRange.until) continue
          // Commit passed date filter — boost score
          commit.score += 10
          commit.matchReasons.push('date match')
        }

        // Author filter
        if (filters.authors.length > 0) {
          const authorLower = author.toLowerCase()
          const emailLower = email.toLowerCase()
          const authorMatch = filters.authors.some(
            (a) => authorLower.includes(a) || emailLower.includes(a),
          )
          if (authorMatch) {
            commit.score += 20
            commit.matchReasons.push('author')
          } else {
            continue // strict author filter
          }
        }

        // Commit type filter
        if (filters.type) {
          const msgLower = message.toLowerCase()
          const typeKeywords = {
            bug: ['fix', 'bug', 'hotfix', 'patch', 'issue', 'resolve', 'error'],
            feature: ['feat', 'add', 'new', 'implement', 'introduce', 'create'],
            refactor: ['refactor', 'restructure', 'cleanup', 'clean up', 'reorganize', 'rename'],
            docs: ['doc', 'readme', 'comment', 'documentation', 'jsdoc'],
            style: ['style', 'css', 'ui', 'design', 'layout', 'theme', 'color'],
            test: ['test', 'spec', 'coverage', 'assert', 'jest', 'mocha'],
            chore: ['chore', 'deps', 'bump', 'upgrade', 'dependency', 'version', 'merge'],
          }
          const kws = typeKeywords[filters.type] || []
          const typeMatch = kws.some((kw) => msgLower.includes(kw))
          if (typeMatch) {
            commit.score += 15
            commit.matchReasons.push(filters.type)
          }
          // Don't skip — type is a soft filter, just don't boost
        }

        // Keyword match
        if (filters.keywords.length > 0) {
          const msgLower = message.toLowerCase()
          const authorLower = author.toLowerCase()
          for (const kw of filters.keywords) {
            if (msgLower.includes(kw)) {
              commit.score += 10
              commit.matchReasons.push(`"${kw}"`)
            } else if (authorLower.includes(kw)) {
              commit.score += 5
              commit.matchReasons.push(`"${kw}"`)
            }
          }
        }

        // File match — mark for lazy check
        if (filters.files.length > 0) {
          commit._needsFileCheck = true
          commit.score += 1 // small boost so it enters results
        }

        // Include commit if it has any score, or if no specific filters were set
        // (just date range means show all in range)
        if (commit.score > 0 || !hasAnyFilter) {
          commit.score = Math.max(commit.score, 1)
          results.push(commit)
        }
      }
    } catch (err) {
      // Skip repos that fail (not a git repo, empty, etc.)
      // Skip repos that fail silently
    }
  }

  // ── Lazy file matching for top results ──────────────────────────

  if (filters.files.length > 0) {
    const candidates = results
      .filter((r) => r._needsFileCheck)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)

    for (const commit of candidates) {
      try {
        const changes = await diffSummary(commit.repo, commit.oid)
        if (!Array.isArray(changes)) continue
        const changedPaths = changes.map((c) => (c.filepath || '').toLowerCase())

        for (const f of filters.files) {
          const fLower = f.toLowerCase()
          const fileMatch = changedPaths.some(
            (p) => p.includes(fLower) || p.endsWith(fLower) ||
                   (p.split('/').pop() || '').includes(fLower),
          )
          if (fileMatch) {
            commit.score += 25
            commit.matchReasons.push(`file: ${f}`)
          }
        }
      } catch {
        // Skip
      }
    }

    // Remove results that were only there for file check but didn't match
    for (const r of results) {
      if (r._needsFileCheck && !r.matchReasons.some((m) => m.startsWith('file:'))) {
        r.score -= 1 // remove the boost we added
      }
    }
  }

  // Clean up internal flags
  results.forEach((r) => delete r._needsFileCheck)

  // Remove results with score <= 0
  const finalResults = results.filter((r) => r.score > 0)

  // Sort by score (desc), then by timestamp (newest first)
  finalResults.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)

  return {
    results: finalResults.slice(0, filters.limit),
    aiIntent,
    aiAvailable: isAIAvailable(),
  }
}


// =====================================================================
//  SUGGESTED QUERIES — contextual examples
// =====================================================================

export const SUGGESTED_QUERIES = [
  { icon: '🔍', text: 'show commits from today', category: 'time' },
  { icon: '📅', text: 'changes from last week', category: 'time' },
  { icon: '🐛', text: 'bug fixes this month', category: 'type' },
  { icon: '✨', text: 'new features added recently', category: 'type' },
  { icon: '📄', text: 'who modified index.tsx', category: 'file' },
  { icon: '🔧', text: 'refactoring changes', category: 'type' },
  { icon: '📁', text: 'changes to services', category: 'file' },
  { icon: '🧪', text: 'test-related commits', category: 'type' },
]

/**
 * Get query suggestions based on partial input
 */
export function getSuggestions(partialQuery) {
  if (!partialQuery || partialQuery.length < 2) return SUGGESTED_QUERIES

  const q = partialQuery.toLowerCase()
  const matching = SUGGESTED_QUERIES.filter((s) =>
    s.text.toLowerCase().includes(q),
  )
  if (matching.length > 0) return matching

  const dynamic = []
  if (/who|author|by/.test(q)) {
    dynamic.push({ icon: '👤', text: `${partialQuery} this week`, category: 'author' })
    dynamic.push({ icon: '👤', text: `${partialQuery} last month`, category: 'author' })
  }
  if (/file|change|modif/.test(q)) {
    dynamic.push({ icon: '📄', text: `${partialQuery} today`, category: 'file' })
    dynamic.push({ icon: '📄', text: `${partialQuery} this week`, category: 'file' })
  }
  return dynamic.length > 0 ? dynamic : SUGGESTED_QUERIES
}


// =====================================================================
//  HELPERS
// =====================================================================

function isTimeWord(w) {
  return /^(day|week|month|year|today|yesterday|ago|last|this|since|before|after)s?$/i.test(w)
}
