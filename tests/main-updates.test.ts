import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RELEASES_API,
  checkForUpdate,
  isNewer,
  parseVersion,
  readRelease
} from '../src/main/updates.ts'
import { pickRendererSettings } from '../src/main/settings-schema.ts'

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v1.2.0',
  draft: false,
  prerelease: false,
  html_url: 'https://github.com/njaske/SimpleMD/releases/tag/v1.2.0',
  ...over
})

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('parseVersion', () => {
  it('reads plain and v-prefixed versions', () => {
    assert.deepEqual(parseVersion('1.1.1'), [1, 1, 1])
    assert.deepEqual(parseVersion('v2.10.0'), [2, 10, 0])
  })

  it('refuses anything else, pre-releases included', () => {
    for (const bad of ['', 'v1.2', '1.2.3.4', '1.2.3-beta.1', 'latest', ' 1.2.3', 'v01.2.3x', 42, null]) {
      assert.equal(parseVersion(bad as string), null, String(bad))
    }
  })
})

describe('isNewer', () => {
  it('compares major, then minor, then patch, as numbers', () => {
    assert.equal(isNewer('1.1.2', '1.1.1'), true)
    assert.equal(isNewer('1.2.0', '1.1.9'), true)
    assert.equal(isNewer('2.0.0', '1.99.99'), true)
    assert.equal(isNewer('1.10.0', '1.9.0'), true)
    assert.equal(isNewer('1.1.1', '1.1.1'), false)
    assert.equal(isNewer('1.1.0', '1.1.1'), false)
    assert.equal(isNewer('junk', '1.1.1'), false)
  })
})

describe('readRelease', () => {
  it('reports a newer release with its page on GitHub', () => {
    assert.deepEqual(readRelease(release(), '1.1.1'), {
      current: '1.1.1',
      latest: '1.2.0',
      available: true,
      url: 'https://github.com/njaske/SimpleMD/releases/tag/v1.2.0'
    })
  })

  it('says nothing is available when the release is not newer', () => {
    assert.equal(readRelease(release({ tag_name: 'v1.1.1' }), '1.1.1')?.available, false)
    assert.equal(readRelease(release({ tag_name: 'v1.0.0' }), '1.1.1')?.available, false)
  })

  it('builds the page link from the tag, never trusting a link in the reply', () => {
    const info = readRelease(release({ html_url: 'https://evil.example/download.exe' }), '1.1.1')
    assert.equal(info?.url, 'https://github.com/njaske/SimpleMD/releases/tag/v1.2.0')
  })

  it('ignores drafts, pre-releases and malformed replies', () => {
    assert.equal(readRelease(release({ draft: true }), '1.1.1'), null)
    assert.equal(readRelease(release({ prerelease: true }), '1.1.1'), null)
    assert.equal(readRelease(release({ tag_name: 'v2.0.0-rc.1' }), '1.1.1'), null)
    assert.equal(readRelease(release({ tag_name: 7 }), '1.1.1'), null)
    assert.equal(readRelease(null, '1.1.1'), null)
    assert.equal(readRelease([release()], '1.1.1'), null)
  })
})

describe('checkForUpdate', () => {
  it('asks GitHub for the latest release only, sending nothing but its name and version', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const result = await checkForUpdate('1.1.1', async (url, init) => {
      calls.push({ url: String(url), init })
      return reply(release())
    })

    assert.equal(result.ok, true)
    assert.equal(result.ok && result.info.latest, '1.2.0')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, RELEASES_API)
    assert.equal(RELEASES_API, 'https://api.github.com/repos/njaske/SimpleMD/releases/latest')
    const headers = new Headers(calls[0].init?.headers)
    assert.deepEqual([...headers.keys()].sort(), ['accept', 'user-agent'])
    assert.equal(headers.get('user-agent'), 'SimpleMD/1.1.1')
    assert.equal(calls[0].init?.method ?? 'GET', 'GET')
    assert.equal(calls[0].init?.body, undefined)
  })

  it('reports GitHub errors and odd replies as unavailable', async () => {
    assert.deepEqual(await checkForUpdate('1.1.1', async () => reply({ message: 'rate limited' }, 403)), {
      ok: false,
      error: 'unavailable'
    })
    assert.deepEqual(await checkForUpdate('1.1.1', async () => reply(release({ draft: true }))), {
      ok: false,
      error: 'unavailable'
    })
    assert.deepEqual(
      await checkForUpdate('1.1.1', async () => new Response('<html>not json</html>', { status: 200 })),
      { ok: false, error: 'unavailable' }
    )
  })

  it('reports no connection as offline', async () => {
    const result = await checkForUpdate('1.1.1', async () => {
      throw new TypeError('fetch failed')
    })
    assert.deepEqual(result, { ok: false, error: 'offline' })
  })

  it('gives up after the timeout', async () => {
    const result = await checkForUpdate(
      '1.1.1',
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
      20
    )
    assert.deepEqual(result, { ok: false, error: 'offline' })
  })
})

describe('update settings from the page', () => {
  it('accepts the update choice, last check time and a skipped version', () => {
    assert.deepEqual(pickRendererSettings({ updateChecks: 'on', lastUpdateCheck: 1_700_000_000_000, skippedUpdate: '1.2.0' }), {
      updateChecks: 'on',
      lastUpdateCheck: 1_700_000_000_000,
      skippedUpdate: '1.2.0'
    })
    assert.deepEqual(pickRendererSettings({ skippedUpdate: '' }), { skippedUpdate: '' })
  })

  it('drops values of the wrong shape', () => {
    assert.deepEqual(
      pickRendererSettings({ updateChecks: 'always', lastUpdateCheck: -5, skippedUpdate: 'https://evil.example' }),
      {}
    )
  })
})
