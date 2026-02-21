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
 * Use LLM to parse a natural-language query into structured filters.
 * Returns parsed JSON or null on failure (falls back to regex parser).
 */
export async function aiParseQuery(query) {
  const prompt = `You are a Git commit search query parser. Parse the following natural language query into a JSON object with these fields:
- authors: array of author names/emails mentioned (empty if none)
- files: array of file paths, file names, or folder names mentioned (empty if none)
- dateRange: object with "since" and/or "until" as ISO date strings, or null. Use today's date ${new Date().toISOString().split('T')[0]} as reference.
- type: one of "bug", "feature", "refactor", "docs", "style", "test", "chore", or null
- keywords: array of important search keywords NOT covered by other fields (empty if none)
- intent: a one-line description of what the user is looking for

Query: "${query}"

Respond ONLY with valid JSON, no markdown, no explanation.`

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
 * Check if AI features are available (API key is set).
 */
export function isAIAvailable() {
  return !!getApiKey()
}
