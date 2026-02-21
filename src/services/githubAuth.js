/**
 * Add a collaborator to a repo (GitHub API).
 * @param {string} owner - repo owner
 * @param {string} repo - repo name
 * @param {string} username - GitHub username to invite
 * @param {string} [permission] - 'push', 'pull', 'admin' (default: 'push')
 */
export async function addCollaborator(
  owner,
  repo,
  username,
  permission = 'push',
) {
  const auth = await _load()
  if (!auth?.token) throw new Error('GitHub PAT not configured')
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${auth.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission }),
    },
  )
  if (resp.status === 201 || resp.status === 204) return true
  const body = await resp.text()
  throw new Error(`GitHub API ${resp.status}: ${body.slice(0, 300)}`)
}

/**
 * Remove a collaborator from a repo (GitHub API).
 */
export async function removeCollaborator(owner, repo, username) {
  const auth = await _load()
  if (!auth?.token) throw new Error('GitHub PAT not configured')
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `token ${auth.token}`,
        Accept: 'application/vnd.github+json',
      },
    },
  )
  if (resp.status === 204 || resp.status === 200) return true
  const body = await resp.text()
  throw new Error(`GitHub API ${resp.status}: ${body.slice(0, 300)}`)
}
/**
 * GitHub PAT storage & HTTP helper for isomorphic-git.
 *
 * Stores the token + username in a JSON file inside the app's document directory.
 * Provides the `http` plugin and `onAuth` callback that isomorphic-git needs
 * for clone / fetch / push / pull over HTTPS.
 */
import * as FileSystem from 'expo-file-system/legacy'
import http from 'isomorphic-git/http/web'

const AUTH_FILE = `${FileSystem.documentDirectory}github_auth.json`

let _cache = null // { token, username }

// ── Persistence ────────────────────────────────────────────────────

async function _load() {
  if (_cache) return _cache
  try {
    const raw = await FileSystem.readAsStringAsync(AUTH_FILE)
    _cache = JSON.parse(raw)
    return _cache
  } catch {
    return null
  }
}

export async function saveGitHubAuth(token, username) {
  _cache = { token, username }
  await FileSystem.writeAsStringAsync(AUTH_FILE, JSON.stringify(_cache))
}

export async function getGitHubAuth() {
  return _load()
}

export async function clearGitHubAuth() {
  _cache = null
  try {
    await FileSystem.deleteAsync(AUTH_FILE, { idempotent: true })
  } catch {
    /* ignore */
  }
}

export async function isGitHubLinked() {
  const auth = await _load()
  return !!auth?.token
}

// ── isomorphic-git helpers ─────────────────────────────────────────

/** The HTTP plugin isomorphic-git uses internally (web Fetch based). */
export { http }

/**
 * Returns an onAuth callback that provides the stored PAT.
 * Usage:  git.clone({ ..., http, onAuth: await getOnAuth() })
 */
export async function getOnAuth() {
  const auth = await _load()
  if (!auth?.token)
    throw new Error('GitHub PAT not configured – go to Settings')
  return () => ({ username: auth.token, password: 'x-oauth-basic' })
}

/**
 * Validate a PAT by calling /user on the GitHub API.
 * Returns { login, name, avatar_url } on success, throws on failure.
 */
export async function validatePAT(token) {
  const resp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`GitHub API ${resp.status}: ${text.slice(0, 200)}`)
  }
  return resp.json()
}

/**
 * List the authenticated user's repositories (auto-paginated).
 * Returns an array of { name, full_name, clone_url, private, description, owner, permissions }.
 * @param {object} opts
 * @param {number} opts.maxPages - stop after N pages (default 5 = 500 repos)
 * @param {string} opts.affiliation - owner,collaborator,organization_member (default all three)
 */
export async function listGitHubRepos({
  maxPages = 5,
  affiliation = 'owner,collaborator,organization_member',
} = {}) {
  const auth = await _load()
  if (!auth?.token) throw new Error('GitHub PAT not configured')

  let allRepos = []
  for (let page = 1; page <= maxPages; page++) {
    const resp = await fetch(
      `https://api.github.com/user/repos?sort=updated&per_page=100&page=${page}&affiliation=${affiliation}`,
      {
        headers: {
          Authorization: `token ${auth.token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    )
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`)
    const repos = await resp.json()
    allRepos = allRepos.concat(repos)
    if (repos.length < 100) break // last page
  }
  return allRepos
}

/**
 * Get a single repo's details from GitHub API.
 */
export async function getGitHubRepo(owner, repo) {
  const auth = await _load()
  if (!auth?.token) throw new Error('GitHub PAT not configured')
  const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `token ${auth.token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}`)
  return resp.json()
}

/**
 * List collaborators on a repo.
 */
export async function listCollaborators(owner, repo) {
  const auth = await _load()
  if (!auth?.token) throw new Error('GitHub PAT not configured')
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/collaborators`,
    {
      headers: {
        Authorization: `token ${auth.token}`,
        Accept: 'application/vnd.github+json',
      },
    },
  )
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}`)
  return resp.json()
}

/**
 * Get the authenticated user's profile info.
 */
export async function getGitHubUser() {
  const auth = await _load()
  if (!auth?.token) throw new Error('GitHub PAT not configured')
  const resp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${auth.token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}`)
  return resp.json()
}

/**
 * Create a new repository on GitHub.
 * @param {string} name - Repository name
 * @param {object} opts
 * @param {string} opts.description - Optional description
 * @param {boolean} opts.isPrivate - Default true
 * @param {boolean} opts.autoInit - Create with README (default false, we push our own)
 * @returns {{ clone_url, html_url, full_name }}
 */
export async function createGitHubRepo(
  name,
  { description = '', isPrivate = true, autoInit = false } = {},
) {
  const auth = await _load()
  if (!auth?.token) throw new Error('GitHub PAT not configured')
  const resp = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `token ${auth.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
      auto_init: autoInit,
    }),
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`GitHub API ${resp.status}: ${body.slice(0, 300)}`)
  }
  return resp.json()
}

/**
 * Get the stored username synchronously (from cache).
 * Returns null if not loaded yet.
 */
export function getCachedUsername() {
  return _cache?.username ?? null
}
