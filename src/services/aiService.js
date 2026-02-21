/**
 * aiService.js
 *
 * LLM-powered intelligence layer using Groq API (openai/gpt-oss-120b).
 * Enhances Smart Search with:
 *  1. Better query understanding (NL → structured intent)
 *  2. Natural language summaries of search results
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'openai/gpt-oss-120b'
const COMMIT_MODEL = 'llama-3.3-70b-versatile'  // reliable model for short text generation

function getApiKey() {
  return process.env.EXPO_PUBLIC_GROQ_API_KEY || null
}

/**
 * Call Groq API with a prompt. Returns the text response.
 * Gracefully returns null if API key is missing or call fails.
 */
async function callLLM(prompt, { maxTokens = 512, temperature = 0.3 } = {}) {
  const apiKey = getApiKey()
  if (!apiKey) return null

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
    })

    if (!res.ok) {
      console.warn('Groq API error:', res.status, await res.text().catch(() => ''))
      return null
    }

    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? null
  } catch (err) {
    console.warn('Groq API call failed:', err?.message)
    return null
  }
}

/**
 * Like callLLM but throws on failure so the caller gets a real error message.
 */
async function callLLMOrThrow(prompt, opts = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('GROQ API key not set. Add EXPO_PUBLIC_GROQ_API_KEY to your .env and restart Expo with --clear.')

  const { maxTokens = 512, temperature = 0.3, model = MODEL } = opts
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Groq API ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json()
  const choice = data?.choices?.[0]
  const content = choice?.message?.content ?? choice?.text
  if (!content) {
    const reason = choice?.finish_reason ?? 'unknown'
    throw new Error(`Groq returned an empty response (finish_reason: ${reason})`)
  }
  return content
}

/**
 * Use LLM to parse a natural-language query into structured filters.
 * Returns parsed JSON or null on failure (falls back to regex parser).
 */
export async function aiParseQuery(query) {
  const today = new Date().toISOString().split('T')[0]
  const prompt = `Parse this Git search query into JSON. Today is ${today}.

Rules:
- authors: extract mentioned person names/usernames (empty array if none)
- files: extract file names, paths, or folder names like "services", "auth", "login.tsx" (empty if none)
- dateRange: {"since":"YYYY-MM-DD"} or {"since":"YYYY-MM-DD","until":"YYYY-MM-DD"} or null
  - "today" → since today, "last week" → since 7 days ago, "this month" → since 1st of month
- type: one of bug/feature/refactor/docs/style/test/chore or null
  - "bug fixes" → "bug", "new features" → "feature", "refactoring" → "refactor"
- keywords: ONLY important search terms not captured above. Keep minimal. Do NOT include generic words.
- intent: one sentence describing what the user wants

Query: "${query}"

Respond with ONLY valid JSON, no markdown fences.`

  const result = await callLLM(prompt, { maxTokens: 300, temperature: 0.1 })
  if (!result) return null

  try {
    // Strip any markdown code fences if present
    const cleaned = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // Convert ISO date strings to ms timestamps
    if (parsed.dateRange) {
      if (parsed.dateRange.since) {
        parsed.dateRange.since = new Date(parsed.dateRange.since).getTime()
      }
      if (parsed.dateRange.until) {
        parsed.dateRange.until = new Date(parsed.dateRange.until).getTime()
      }
      // Validate
      if (isNaN(parsed.dateRange.since) && isNaN(parsed.dateRange.until)) {
        parsed.dateRange = null
      }
    }

    return parsed
  } catch {
    console.warn('Failed to parse AI response:', result)
    return null
  }
}

/**
 * Generate an AI summary of search results.
 * Returns a concise natural language summary string.
 */
export async function aiSummarizeResults(query, results) {
  if (!results || results.length === 0) return null

  // Build a compact representation of results
  const topResults = results.slice(0, 10).map((r) => ({
    msg: r.message.trim().slice(0, 80),
    author: r.author,
    repo: r.repo,
    date: new Date(r.timestamp).toLocaleDateString(),
    reasons: r.matchReasons?.slice(0, 3),
  }))

  const prompt = `You are a helpful Git assistant. The user searched for: "${query}"

Here are the top matching commits (${results.length} total):
${JSON.stringify(topResults, null, 1)}

Write a brief, helpful 2-3 sentence summary of these results. Mention key patterns you notice (common authors, types of changes, affected areas). Be concise and use a friendly developer tone. Do not use markdown formatting.`

  return callLLM(prompt, { maxTokens: 200, temperature: 0.5 })
}

/**
 * Direct LLM call for search — exported for nlSearchService to use.
 */
export async function callSearchLLM(prompt, options = {}) {
  return callLLM(prompt, options)
}

/**
 * AI Smart Merge: given conflict versions, suggest a merged resolution.
 * Returns { merged, explanation } or null on failure.
 *
 * @param {string} filepath
 * @param {string | null} ours
 * @param {string | null} theirs
 * @param {string | null} [base=null]
 * @returns {Promise<{ merged: string, explanation: string } | null>}
 */
export async function aiSuggestMerge(filepath, ours, theirs, base = null) {
  const ext = filepath.split('.').pop() || ''
  const prompt = `You are an expert code merge assistant. Merge these two conflicting versions of a file intelligently.

File: ${filepath}
${base ? `\n--- BASE (common ancestor) ---\n${base.slice(0, 2000)}\n` : ''}
--- OURS (current branch) ---
${(ours || '').slice(0, 2000)}

--- THEIRS (incoming branch) ---
${(theirs || '').slice(0, 2000)}

Rules:
1. Produce a MERGED result that combines BOTH changes intelligently
2. If both sides modified the same lines, keep the more complete/correct version
3. If changes are in different areas, include BOTH
4. Do NOT include conflict markers (<<<, ===, >>>)
5. Preserve the original code style and formatting
6. If one side added new code and the other didn't touch that area, include the addition

Respond with ONLY this JSON format (no markdown fences):
{
  "merged": "...the merged file content...",
  "explanation": "Brief 1-2 sentence explanation of what was merged and how"
}`

  const result = await callLLM(prompt, { maxTokens: 2048, temperature: 0.1 })
  if (!result) return null

  try {
    const cleaned = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    // If JSON parse fails, try to extract just the merged content
    try {
      const mergedMatch = result.match(/"merged"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"explanation|"\s*})/)?.[1]
      if (mergedMatch) {
        return {
          merged: mergedMatch.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
          explanation: 'AI merged the changes (partial parse)',
        }
      }
    } catch { /* fall through */ }
    console.warn('Failed to parse AI merge response:', result?.slice(0, 200))
    return null
  }
}

/**
 * Check if AI features are available (API key is set).
 */
export function isAIAvailable() {
  return !!getApiKey()
}

/**
 * Generate a concise, conventional commit message from a git diff.
 *
 * @param {string} diff          - Output of `git diff --staged` (or diff summary)
 * @param {string[]} [files]     - Optional list of changed file paths for context
 * @returns {Promise<string|null>} Commit message or null if AI unavailable
 */
export async function generateCommitMessage(diff, files = []) {
  const fileList = files.length
    ? `Changed files:\n${files.map(f => `  - ${f}`).join('\n')}\n\n`
    : ''

  const truncatedDiff = diff.length > 4000
    ? diff.slice(0, 4000) + '\n... (diff truncated)'
    : diff

  const prompt = `You are an expert developer who writes excellent Git commit messages following the Conventional Commits spec.

${fileList}Here is the git diff:
\`\`\`diff
${truncatedDiff}
\`\`\`

Write a commit message following these rules:
1. First line: type(scope): short summary — max 72 chars
   Types: feat, fix, refactor, chore, docs, style, test, perf
2. Optionally add 2-4 bullet points for complex changes
3. Be specific and technical — mention what changed and why
4. Do NOT wrap in markdown fences
5. Respond with ONLY the commit message, nothing else

Example good messages:
feat(editor): add lazy file loading with LRU cache eviction
fix(git): prevent index corruption on crash with atomic writes
refactor(auth): extract token refresh into separate service`

  // Use llama-3.3-70b which reliably generates short commit messages
  const result = await callLLMOrThrow(prompt, { maxTokens: 300, temperature: 0.4, model: COMMIT_MODEL })
  return result.trim()
}
