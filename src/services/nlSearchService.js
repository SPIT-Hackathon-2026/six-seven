/**
 * nlSearchService.js
 *
 * LLM-first commit search. Sends full commit history to LLM
 * and lets it find matching commits based on natural language.
 * Falls back to basic text search when API is unavailable.
 */

import { getLog } from './gitService'
import { listRepos } from './repoService'
import { isAIAvailable } from './aiService'

export { isAIAvailable }

// =====================================================================
//  CORE: Gather all commits from local repos
// =====================================================================

async function getAllCommits(repoName = null) {
  let repos
  if (repoName) {
    repos = [{ name: repoName }]
  } else {
    const allRepos = await listRepos()
    repos = allRepos.filter((r) => r.isGitRepo === true)
  }

  const commits = []

  for (const repo of repos) {
    try {
      const log = await getLog(repo.name, { depth: 100 })
      if (!log || !Array.isArray(log)) continue

      for (const entry of log) {
        const message = (entry.commit?.message ?? entry.message ?? '').trim()
        const author = entry.commit?.author?.name ?? entry.author ?? 'Unknown'
        const email = entry.commit?.author?.email ?? entry.email ?? ''
        const rawTs = entry.commit?.author?.timestamp ?? entry.timestamp ?? 0
        const timestampMs = rawTs > 1e12 ? rawTs : rawTs * 1000

        commits.push({
          repo: repo.name,
          oid: entry.oid,
          shortOid: entry.oid.slice(0, 7),
          message,
          author,
          email,
          timestamp: timestampMs,
          date: new Date(timestampMs).toISOString().split('T')[0],
          time: new Date(timestampMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        })
      }
    } catch {
      // Skip repos with no commits
    }
  }

  return commits
}

// =====================================================================
//  LLM SEARCH — send history + query to LLM
// =====================================================================

async function llmSearch(query, commits) {
  const { callSearchLLM } = await import('./aiService')

  // Build compact commit list for the prompt
  const commitList = commits.map((c, i) =>
    `[${i}] ${c.shortOid} | ${c.date} ${c.time} | ${c.author} | ${c.repo} | ${c.message.slice(0, 120)}`
  ).join('\n')

  const today = new Date().toISOString().split('T')[0]
  const prompt = `You are a smart Git search assistant. Today is ${today}.

Here is the complete commit history of the user's local repositories:

${commitList}

The user searched: "${query}"

Return a JSON array of matching commit indices (the [N] numbers) with a reason for each match, sorted by relevance. Format:
[{"idx": 0, "reason": "brief reason"}, ...]

Rules:
- Match based on the user's intent, not just keywords
- "today" means date ${today}
- "last week" means since ${new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]}
- "this month" means since ${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]}
- If the user asks about a type like "bug fixes", match commits whose messages suggest fixes
- If the user asks "who modified X", look for the file/folder name in commit messages  
- Return at most 30 results
- If nothing matches, return an empty array []

Respond with ONLY the JSON array, no markdown, no explanation.`

  const result = await callSearchLLM(prompt, { maxTokens: 1000, temperature: 0.1 })
  if (!result) return null

  try {
    const cleaned = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return null

    // Map indices back to commit objects
    return parsed
      .filter((item) => item.idx >= 0 && item.idx < commits.length)
      .map((item) => ({
        ...commits[item.idx],
        score: 30 - parsed.indexOf(item), // higher rank = higher score
        matchReasons: [item.reason || 'AI match'],
      }))
  } catch (err) {
    console.warn('LLM search parse error:', err)
    return null
  }
}

// =====================================================================
//  FALLBACK: Basic text search (when LLM is unavailable)
// =====================================================================

function textSearch(query, commits) {
  const q = query.toLowerCase().trim()
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w))

  // Date extraction for fallback
  let dateFilter = null
  const now = Date.now()
  const DAY = 86400000

  if (/\btoday\b/i.test(q)) {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    dateFilter = { since: d.getTime() }
  } else if (/\byesterday\b/i.test(q)) {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0)
    const e = new Date(); e.setHours(0, 0, 0, 0)
    dateFilter = { since: d.getTime(), until: e.getTime() }
  } else if (/last\s+week/i.test(q)) {
    dateFilter = { since: now - 7 * DAY }
  } else if (/this\s+week/i.test(q)) {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0)
    dateFilter = { since: d.getTime() }
  } else if (/last\s+month/i.test(q)) {
    dateFilter = { since: now - 30 * DAY }
  } else if (/this\s+month/i.test(q)) {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
    dateFilter = { since: d.getTime() }
  } else if (/recently/i.test(q)) {
    dateFilter = { since: now - 14 * DAY }
  }

  const results = []

  for (const c of commits) {
    // Date filter
    if (dateFilter) {
      if (dateFilter.since && c.timestamp < dateFilter.since) continue
      if (dateFilter.until && c.timestamp > dateFilter.until) continue
    }

    let score = 0
    const reasons = []

    if (dateFilter) {
      score += 5
      reasons.push('date match')
    }

    const msgLower = c.message.toLowerCase()
    const authorLower = c.author.toLowerCase()

    // Word matching
    for (const w of words) {
      if (msgLower.includes(w)) {
        score += 10
        reasons.push(`"${w}"`)
      } else if (authorLower.includes(w)) {
        score += 5
        reasons.push(`author: ${w}`)
      }
    }

    // Full query match
    if (q.length > 4 && msgLower.includes(q)) {
      score += 20
      reasons.push('exact match')
    }

    // Type matching
    const typePatterns = {
      fix: /\b(?:fix|bug|hotfix|patch|resolve|error)\b/i,
      feature: /\b(?:feat|add|new|implement|introduce|create)\b/i,
      refactor: /\b(?:refactor|cleanup|restructure|rename)\b/i,
      test: /\b(?:test|spec|coverage)\b/i,
    }
    for (const [type, re] of Object.entries(typePatterns)) {
      if (re.test(q) && re.test(msgLower)) {
        score += 10
        reasons.push(type)
      }
    }

    if (score > 0) {
      // Recency boost
      const ageH = (now - c.timestamp) / 3600000
      if (ageH < 24) score += 3
      else if (ageH < 168) score += 1

      results.push({ ...c, score, matchReasons: [...new Set(reasons)] })
    }
  }

  results.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
  return results.slice(0, 50)
}

// =====================================================================
//  MAIN SEARCH FUNCTION
// =====================================================================

export async function searchCommits(query, repoName = null) {
  const commits = await getAllCommits(repoName)

  if (commits.length === 0) {
    return { results: [], aiIntent: null, aiAvailable: isAIAvailable() }
  }

  // Try LLM search first
  if (isAIAvailable()) {
    try {
      const llmResults = await llmSearch(query, commits)
      if (llmResults && llmResults.length > 0) {
        return {
          results: llmResults,
          aiIntent: `AI searched ${commits.length} commits across your repos`,
          aiAvailable: true,
        }
      }
      // LLM returned empty — fall through to text search
    } catch (err) {
      console.warn('LLM search failed, falling back:', err?.message)
    }
  }

  // Fallback to text search
  const textResults = textSearch(query, commits)
  return {
    results: textResults,
    aiIntent: null,
    aiAvailable: isAIAvailable(),
  }
}

// Kept for the UI filter preview
export function parseQuery(query) {
  return { authors: [], files: [], keywords: [], dateRange: null, type: null, limit: 50 }
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
  return matching.length > 0 ? matching : SUGGESTED_QUERIES
}

export function aiSummarizeResults() { return null } // handled by main LLM now

// =====================================================================
//  HELPERS
// =====================================================================

const STOP_WORDS = new Set([
  'show', 'me', 'the', 'all', 'find', 'search', 'for', 'get', 'list',
  'what', 'which', 'where', 'when', 'who', 'how', 'did', 'does',
  'is', 'are', 'was', 'were', 'has', 'have', 'had', 'been',
  'an', 'of', 'in', 'on', 'at', 'to', 'with', 'from', 'by',
  'about', 'like', 'that', 'this', 'and', 'or', 'but', 'not',
  'changes', 'changed', 'change', 'commits', 'commit',
  'modified', 'modify', 'recent', 'latest', 'added', 'made',
])
