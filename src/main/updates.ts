import type { UpdateInfo, UpdateResult } from '../shared/types'

// The optional update check: one GET to GitHub's "latest release" endpoint, at an address
// fixed here (the page can't choose what to contact). It sends only an Accept header and
// a User-Agent naming the app and its version, as GitHub requires; nothing about the user
// or their files. Only a published, non-pre-release version newer than this one counts.

const REPO = 'njaske/SimpleMD'
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASE_PAGE = `https://github.com/${REPO}/releases/tag/`
/** Give up on a slow network after this long; the check is never worth a wait. */
const TIMEOUT_MS = 10_000

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** "1.2.3" or "v1.2.3" as numbers; null for anything else, pre-releases included. */
export function parseVersion(v: string): [number, number, number] | null {
  if (typeof v !== 'string') return null
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True when version `a` is newer than `b`. */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** Read GitHub's reply. The link is built from the tag, never taken from the reply. */
export function readRelease(json: unknown, current: string): UpdateInfo | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const release = json as Record<string, unknown>
  if (release.draft === true || release.prerelease === true) return null
  const tag = release.tag_name
  if (typeof tag !== 'string' || !parseVersion(tag)) return null
  const latest = tag.replace(/^v/, '')
  return { current, latest, available: isNewer(latest, current), url: RELEASE_PAGE + tag }
}

/** Ask GitHub for the latest release. Never throws: no connection (or a timeout) is
 *  `offline`, any other trouble (rate limit, odd reply) is `unavailable`. */
export async function checkForUpdate(current: string, fetchImpl: Fetch, timeoutMs = TIMEOUT_MS): Promise<UpdateResult> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetchImpl(RELEASES_API, {
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `SimpleMD/${current}` },
        signal: abort.signal,
        credentials: 'omit',
        redirect: 'error'
      })
    } catch {
      return { ok: false, error: 'offline' }
    }
    if (!res.ok) return { ok: false, error: 'unavailable' }
    const info = readRelease(await res.json().catch(() => null), current)
    return info ? { ok: true, info } : { ok: false, error: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}
