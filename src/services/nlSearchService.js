/**
 * nlSearchService.js
 *
 * Natural-language commit search engine.
 * Parses human queries like "who modified login.tsx last week"
 * into structured filters, then searches the git log across repos.
 */

import { getLog, diffSummary } from './gitService'
import { listRepos } from './repoService'
import { aiParseQuery, aiSummarizeResults, isAIAvailable } from './aiService'

// Re-export AI functions for the UI
export { aiSummarizeResults, isAIAvailable }

// =====================================================================
//  QUERY PARSER — Natural Language → Structured Filters
// =====================================================================

export function parseQuery(query) {
  const q = query.trim().toLowerCase()
  const filters = {
    authors: [],
    files: [],
    keywords: [],
    dateRange: null,
    repo: null,
    type: null,
    limit: 50,
  }

  let remaining = q

  // ── Author extraction ──────────────────────────────────────────
  const authorMatch = remaining.match(/(?:by|from|author)\s+["']?([a-zA-Z0-9_.\-@]+)["']?/i)
  if (authorMatch && authorMatch[1] && authorMatch[1].length > 1) {
    const author = authorMatch[1].trim()
    // Don't capture time words or common prepositions as authors
    if (!isTimeWord(author) && !isStopWord(author)) {
      filters.authors.push(author)
      remaining = remaining.replace(authorMatch[0], ' ')
    }
  }

  // ── File / path extraction ─────────────────────────────────────
  // Match explicit file extensions
  const fileRegex = /\b([a-z0-9_/\-]+\.[a-z]{1,6})\b/gi
  let fm
  while ((fm = fileRegex.exec(remaining)) !== null) {
    const f = fm[1]
    if (f && !['e.g', 'i.e', 'vs.', 'etc.'].includes(f) && f.length > 2) {
      filters.files.push(f)
    }
  }

  // "changes to <folder>", "in <folder>"
  const folderMatch = remaining.match(/(?:changes?\s+(?:to|in)|(?:in|to)\s+(?:the\s+)?)(?:folder|dir(?:ectory)?|module)?\s*["']?([a-z0-9_/\-]+)["']?/i)
  if (folderMatch && folderMatch[1] && folderMatch[1].length > 1 && !isTimeWord(folderMatch[1]) && !isStopWord(folderMatch[1])) {
    filters.files.push(folderMatch[1])
    remaining = remaining.replace(folderMatch[0], ' ')
  }

  // ── Date range extraction ──────────────────────────────────────
  const now = Date.now()
  const DAY = 86400000
  const WEEK = 7 * DAY
  const MONTH = 30 * DAY

  if (/\btoday\b/i.test(remaining)) {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    filters.dateRange = { since: d.getTime() }
    remaining = remaining.replace(/\btoday\b/gi, ' ')
  } else if (/\byesterday\b/i.test(remaining)) {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0)
    const e = new Date(); e.setHours(0, 0, 0, 0)
    filters.dateRange = { since: d.getTime(), until: e.getTime() }
    remaining = remaining.replace(/\byesterday\b/gi, ' ')
  } else {
    const lastMatch = remaining.match(/(?:last|past)\s+(\d+\s+)?(?:day|week|month|year)s?/i)
    if (lastMatch) {
      const num = lastMatch[1] ? parseInt(lastMatch[1]) : 1
      const full = lastMatch[0].toLowerCase()
      if (full.includes('day'))        filters.dateRange = { since: now - num * DAY }
      else if (full.includes('week'))  filters.dateRange = { since: now - num * WEEK }
      else if (full.includes('month')) filters.dateRange = { since: now - num * MONTH }
      else if (full.includes('year'))  filters.dateRange = { since: now - num * 365 * DAY }
      remaining = remaining.replace(lastMatch[0], ' ')
    }

    const thisMatch = remaining.match(/this\s+(week|month|year)/i)
    if (thisMatch) {
      const unit = thisMatch[1].toLowerCase()
      const start = new Date()
      if (unit === 'week') start.setDate(start.getDate() - start.getDay())
      else if (unit === 'month') start.setDate(1)
      else { start.setMonth(0); start.setDate(1) }
      start.setHours(0, 0, 0, 0)
      filters.dateRange = { since: start.getTime() }
      remaining = remaining.replace(thisMatch[0], ' ')
    }
  }

  if (/\brecently?\b/i.test(remaining) && !filters.dateRange) {
    filters.dateRange = { since: now - 2 * WEEK }
    remaining = remaining.replace(/\brecently?\b/gi, ' ')
  }

  // ── Commit type extraction ─────────────────────────────────────
  const typeMap = {
    bug: /\b(?:bug|bugs|bugfix|fix|fixes|fixed|hotfix|patch)\b/i,
    feature: /\b(?:feature|features|feat|new|implement|implemented|introduce)\b/i,
    refactor: /\b(?:refactor|refactored|refactoring|cleanup|clean[\s-]?up|restructure)\b/i,
    docs: /\b(?:docs?|documentation|readme|comment|comments|jsdoc)\b/i,
    style: /\b(?:style|styling|css|ui|design|layout|theme)\b/i,
    test: /\b(?:tests?|testing|spec|specs|jest|mocha)\b/i,
    chore: /\b(?:chore|deps?|dependency|dependencies|upgrade|bump|version)\b/i,
  }
  for (const [type, re] of Object.entries(typeMap)) {
    if (re.test(remaining)) {
      filters.type = type
      remaining = remaining.replace(re, ' ')
      break
    }
  }

  // ── Remaining keywords ─────────────────────────────────────────
  const words = remaining
    .replace(/[^\w\s.-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !isStopWord(w) && !isTimeWord(w))

  filters.keywords = [...new Set(words)]

  return filters
}

// =====================================================================
//  SEARCH ENGINE
// =====================================================================

export async function searchCommits(query, repoName = null) {
  // Try AI parsing first, fall back to regex
  let filters = null
  let aiIntent = null

  if (isAIAvailable()) {
    try {
      const aiResult = await aiParseQuery(query)
      if (aiResult) {
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
    } catch { /* fall through */ }
  }

  if (!filters) {
    filters = parseQuery(query)
  }

  // Determine repos
  let repos
  if (repoName) {
    repos = [{ name: repoName }]
  } else {
    const allRepos = await listRepos()
    repos = allRepos.filter((r) => r.isGitRepo === true)
  }

  if (repos.length === 0) {
    return { results: [], aiIntent, aiAvailable: isAIAvailable() }
  }

  // Check which filter dimensions are active
  const hasDateFilter = !!filters.dateRange
  const hasAuthorFilter = filters.authors.length > 0
  const hasTypeFilter = !!filters.type
  const hasKeywordFilter = filters.keywords.length > 0
  const hasFileFilter = filters.files.length > 0
  const hasAnyFilter = hasDateFilter || hasAuthorFilter || hasTypeFilter || hasKeywordFilter || hasFileFilter

  const results = []
  const queryLower = query.trim().toLowerCase()

  for (const repo of repos) {
    let log
    try {
      log = await getLog(repo.name, { depth: 100 })
    } catch {
      continue // skip repos with no commits
    }
    if (!log || !Array.isArray(log) || log.length === 0) continue

    for (const entry of log) {
      const message = entry.commit?.message ?? entry.message ?? ''
      const author = entry.commit?.author?.name ?? entry.author ?? 'Unknown'
      const email = entry.commit?.author?.email ?? entry.email ?? ''
      const rawTs = entry.commit?.author?.timestamp ?? entry.timestamp ?? 0
      const timestampMs = rawTs > 1e12 ? rawTs : rawTs * 1000

      const commit = {
        repo: repo.name,
        oid: entry.oid,
        shortOid: entry.oid.slice(0, 7),
        message: message.trim(),
        author,
        email,
        timestamp: timestampMs,
        score: 0,
        matchReasons: [],
      }

      const msgLower = message.toLowerCase()
      const authorLower = author.toLowerCase()

      // ── Date filter (hard filter — skip if outside range) ──
      if (hasDateFilter) {
        if (filters.dateRange.since && timestampMs < filters.dateRange.since) continue
        if (filters.dateRange.until && timestampMs > filters.dateRange.until) continue
        commit.score += 10
        commit.matchReasons.push('date match')
      }

      // ── Author filter (hard filter) ──
      if (hasAuthorFilter) {
        const match = filters.authors.some(
          (a) => authorLower.includes(a.toLowerCase()) || email.toLowerCase().includes(a.toLowerCase()),
        )
        if (match) {
          commit.score += 20
          commit.matchReasons.push('author')
        } else {
          continue
        }
      }

      // ── Type filter (soft — boost matching, slightly penalize non-matching) ──
      if (hasTypeFilter) {
        const typeKeywords = {
          bug: ['fix', 'bug', 'hotfix', 'patch', 'issue', 'resolve', 'error', 'crash'],
          feature: ['feat', 'add', 'new', 'implement', 'introduce', 'create', 'support'],
          refactor: ['refactor', 'restructure', 'cleanup', 'clean', 'reorganize', 'rename', 'move', 'extract'],
          docs: ['doc', 'readme', 'comment', 'documentation', 'jsdoc', 'guide'],
          style: ['style', 'css', 'ui', 'design', 'layout', 'theme', 'color', 'font'],
          test: ['test', 'spec', 'coverage', 'assert', 'jest', 'mock'],
          chore: ['chore', 'dep', 'bump', 'upgrade', 'dependency', 'version', 'merge', 'release'],
        }
        const kws = typeKeywords[filters.type] || []
        if (kws.some((kw) => msgLower.includes(kw))) {
          commit.score += 15
          commit.matchReasons.push(filters.type)
        } else {
          commit.score -= 3
        }
      }

      // ── Keyword match (fuzzy — check message AND author) ──
      if (hasKeywordFilter) {
        for (const kw of filters.keywords) {
          const kwLower = kw.toLowerCase()
          if (msgLower.includes(kwLower)) {
            commit.score += 10
            commit.matchReasons.push(`"${kw}"`)
          } else if (authorLower.includes(kwLower)) {
            commit.score += 5
            commit.matchReasons.push(`author: ${kw}`)
          }
        }
      }

      // ── File check marker ──
      if (hasFileFilter) {
        commit._needsFileCheck = true
        commit.score += 1
      }

      // ── Direct text search (always do this as fallback) ──
      // If the raw query appears in the commit message, boost it
      if (queryLower.length > 3 && msgLower.includes(queryLower)) {
        commit.score += 25
        commit.matchReasons.push('exact match')
      }

      // Include if score > 0, or if only date filter is active (show all in range)
      if (commit.score > 0) {
        results.push(commit)
      } else if (!hasAnyFilter) {
        // No filters at all — show everything, sort by recency
        commit.score = 1
        results.push(commit)
      }
    }
  }

  // ── File matching (lazy, on top candidates) ──
  if (hasFileFilter) {
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
          if (changedPaths.some((p) => p.includes(fLower) || p.endsWith(fLower) || (p.split('/').pop() || '').includes(fLower))) {
            commit.score += 25
            commit.matchReasons.push(`file: ${f}`)
          }
        }
      } catch { /* skip */ }
    }

    // Remove file-check-only results that didn't match
    for (const r of results) {
      if (r._needsFileCheck && !r.matchReasons.some((m) => m.startsWith('file:'))) {
        r.score -= 1
      }
    }
  }

  // Clean up
  results.forEach((r) => delete r._needsFileCheck)

  // Filter out zero/negative scores
  const finalResults = results.filter((r) => r.score > 0)

  // Recency boost: more recent commits get a small boost
  const now = Date.now()
  for (const r of finalResults) {
    const ageHours = (now - r.timestamp) / 3600000
    if (ageHours < 24) r.score += 3
    else if (ageHours < 168) r.score += 1 // within a week
  }

  // Sort by score desc, then timestamp desc
  finalResults.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)

  return {
    results: finalResults.slice(0, filters.limit),
    aiIntent,
    aiAvailable: isAIAvailable(),
  }
}


// =====================================================================
//  SUGGESTED QUERIES
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

export function getSuggestions(partialQuery) {
  if (!partialQuery || partialQuery.length < 2) return SUGGESTED_QUERIES
  const q = partialQuery.toLowerCase()
  const matching = SUGGESTED_QUERIES.filter((s) => s.text.toLowerCase().includes(q))
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
  return /^(day|days|week|weeks|month|months|year|years|today|yesterday|ago|last|past|this|since|before|after|recently|recent)$/i.test(w)
}

function isStopWord(w) {
  const stops = new Set([
    'show', 'me', 'the', 'all', 'find', 'search', 'for', 'get', 'list',
    'what', 'which', 'where', 'when', 'who', 'how', 'did', 'does',
    'is', 'are', 'was', 'were', 'has', 'have', 'had', 'been',
    'an', 'of', 'in', 'on', 'at', 'to', 'with', 'from', 'by',
    'about', 'like', 'that', 'this', 'and', 'or', 'but', 'not',
    'no', 'so', 'if', 'any', 'my', 'our', 'their', 'his', 'her',
    'changes', 'changed', 'change', 'commits', 'commit', 'committed',
    'modified', 'modify', 'modifications', 'recent', 'latest',
    'since', 'before', 'after', 'during', 'between', 'related',
    'added', 'made',
  ])
  return stops.has(w.toLowerCase())
}
