import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { generateKeyPair } from 'jose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startFakeEntra, type FakeEntra } from '../../scripts/fake-entra.ts'
import type { FleetResponse, RegisteredDevice } from '../shared/api.ts'
import type { ScanReport } from '../shared/model.ts'
import { loadConfig, type Config } from './config.ts'
import { EntraVerifier } from './entra.ts'
import { Events } from './events.ts'
import { createDeviceApp, createSessionApp, type HttpDeps } from './http.ts'
import { createLogger } from './log.ts'
import { Store } from './store.ts'

let entra: FakeEntra
let config: Config
let deps: HttpDeps
let clock: number

beforeAll(async () => {
  entra = await startFakeEntra()
  config = loadConfig({ ENTRA_AUTHORITY: entra.authority, ENTRA_TENANT_ID: entra.tenantId, ENTRA_CLIENT_ID: entra.clientId, PUBLIC_URL: 'https://forgitten.example.org' })
})
afterAll(() => entra.close())

beforeEach(() => {
  clock = Date.parse('2026-01-01T12:00:00Z')
  const webDir = mkdtempSync(joinPath(tmpdir(), 'forgitten-web-'))
  writeFileSync(joinPath(webDir, 'index.html'), '<html>the web app</html>')
  deps = {
    config,
    store: new Store(':memory:'),
    events: new Events(),
    verifier: new EntraVerifier({ ...config, ENTRA_TENANT_ID: entra.tenantId, ENTRA_CLIENT_ID: entra.clientId }),
    log: createLogger('test'),
    version: '0.0.0-test',
    webDir,
    now: () => clock,
  }
})

const signedIn = { 'x-forwarded-email': 'user@example.com' }
const json = (body: unknown, headers: Record<string, string> = {}) => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const bearer = async (claims?: Record<string, unknown>) => ({ authorization: `Bearer ${await entra.issue(claims)}` })

const registration = { name: null, hostname: 'laptop', os: 'macos', arch: 'arm64', platform: 'macOS 15', version: '0.1.0' }
const report = (over: Partial<ScanReport> = {}): ScanReport => ({
  schema: 1,
  scannedAt: '2026-01-01T12:00:00+00:00',
  durationMs: 120,
  roots: ['/src'],
  ignore: [],
  intervalMinutes: 15,
  device: { hostname: 'laptop', os: 'macos', arch: 'arm64', platform: 'macOS 15', version: '0.1.0' },
  repos: [
    {
      path: '/src/app',
      name: 'src/app',
      remoteUrl: 'git@example.org:team/app.git',
      stashes: 0,
      worktrees: [{ path: '/src/app', branch: 'main', head: 'abc1234', main: true, staged: 0, modified: 2, untracked: 0, conflicted: 0 }],
      branches: [{ name: 'main', upstream: 'origin/main', upstreamGone: false, ahead: 0, behind: 0, unpushed: 0 }],
      error: null,
    },
  ],
  ...over,
})

async function join(headers?: Record<string, string>): Promise<RegisteredDevice> {
  const response = await createDeviceApp(deps).request('/ingest/v1/devices', { method: 'POST', ...json(registration, headers ?? (await bearer())) })
  expect(response.status).toBe(201)
  return (await response.json()) as RegisteredDevice
}

async function fleet(): Promise<FleetResponse> {
  const response = await createSessionApp(deps).request('/api/fleet', { headers: signedIn })
  expect(response.status).toBe(200)
  return (await response.json()) as FleetResponse
}

describe('session surface', () => {
  it('answers nothing but the health check without a signed-in person', async () => {
    const app = createSessionApp(deps)
    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/devices/some-id'],
      ['GET', '/assets/index.js'],
      ['GET', '/favicon.svg'],
      ['GET', '/api/fleet'],
      ['GET', '/api/events'],
      ['PATCH', '/api/devices/some-id'],
      ['DELETE', '/api/devices/some-id'],
      ['PUT', '/api/devices/some-id/muted'],
    ] as const) {
      const response = await app.request(path, { method })
      expect([path, response.status]).toEqual([path, 401])
      expect(await response.text()).not.toContain('the web app')
    }
    expect((await app.request('/healthz')).status).toBe(200)
  })

  it('serves what a device needs to install the app without a session, and the page names it', async () => {
    const webDir = mkdtempSync(joinPath(tmpdir(), 'forgitten-web-'))
    cpSync('src/web/public', webDir, { recursive: true })
    cpSync('src/web/index.html', joinPath(webDir, 'index.html'))
    const app = createSessionApp({ ...deps, webDir })
    const fetched = async (path: string, type: string) => {
      const response = await app.request(path)
      expect([path, response.status, response.headers.get('content-type')]).toEqual([path, 200, type])
      return Buffer.from(await response.arrayBuffer())
    }
    const size = (png: Buffer) => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
    expect(size(await fetched('/apple-touch-icon.png', 'image/png'))).toBe('180x180')
    expect(size(await fetched('/icon-192.png', 'image/png'))).toBe('192x192')
    expect(size(await fetched('/icon-512.png', 'image/png'))).toBe('512x512')
    const manifest = JSON.parse((await fetched('/manifest.webmanifest', 'application/manifest+json')).toString()) as { display: string; start_url: string; icons: { src: string; sizes: string; purpose: string }[] }
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/' })
    expect(manifest.icons.map((i) => `${i.src} ${i.sizes} ${i.purpose}`)).toEqual(['/icon-192.png 192x192 any', '/icon-512.png 512x512 any', '/icon-512.png 512x512 maskable'])

    const page = await (await app.request('/', { headers: signedIn })).text()
    expect(page).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(page).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(page).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
  })

  it('does not take a bearer token in place of a session', async () => {
    const response = await createSessionApp(deps).request('/api/fleet', { headers: await bearer() })
    expect(response.status).toBe(401)
  })

  it('serves the web app and the fleet to the person the proxy names', async () => {
    const app = createSessionApp(deps)
    expect(await (await app.request('/devices/any', { headers: signedIn })).text()).toContain('the web app')
    const body = await fleet()
    expect(body.user).toBe('user@example.com')
    expect(body.setup).toMatchObject({
      configured: true,
      joinCommand: `forgitten fleet join https://forgitten.example.org --tenant ${entra.tenantId} --client ${entra.clientId} --authority ${entra.authority} --path ~/source`,
    })
  })

  it('never lets a shared cache keep a response', async () => {
    const response = await createSessionApp(deps).request('/api/fleet', { headers: signedIn })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('needs no login when AUTH_MODE is none', async () => {
    deps.config = { ...config, AUTH_MODE: 'none' }
    const response = await createSessionApp(deps).request('/api/fleet')
    expect(((await response.json()) as FleetResponse).user).toBe('local')
  })

  it('refuses to start in proxy mode without an Entra app', () => {
    expect(() => loadConfig({})).toThrow(/ENTRA_TENANT_ID/)
    expect(loadConfig({ AUTH_MODE: 'none' }).ENTRA_TENANT_ID).toBeUndefined()
  })
})

describe('device surface', () => {
  it('rejects every call that does not carry a valid Entra token for this app', async () => {
    const app = createDeviceApp(deps)
    const { privateKey: strangerKey } = await generateKeyPair('RS256')
    const attempts: Record<string, Record<string, string>> = {
      'no token': {},
      'proxy headers instead of a token': signedIn,
      'not a token': { authorization: 'Bearer nonsense' },
      'signed by another key': { authorization: `Bearer ${await entra.issue({}, { key: strangerKey })}` },
      'for another app': { authorization: `Bearer ${await entra.issue({ aud: 'another-app' })}` },
      'from another issuer': { authorization: `Bearer ${await entra.issue({ iss: 'https://login.example.org/other/v2.0' })}` },
      'from another tenant': await bearer({ tid: 'another-tenant' }),
      'without the scope': await bearer({ scp: 'User.Read' }),
      expired: { authorization: `Bearer ${await entra.issue({}, { expiresIn: '-1m' })}` },
    }
    for (const [name, headers] of Object.entries(attempts)) {
      for (const [method, path] of [
        ['POST', '/ingest/v1/devices'],
        ['PUT', '/ingest/v1/devices/x/report'],
        ['DELETE', '/ingest/v1/devices/x'],
        ['GET', '/ingest/v1/anything'],
      ] as const) {
        const response = await app.request(path, method === 'GET' ? { headers } : { method, ...json(registration, headers) })
        expect([name, path, response.status]).toEqual([name, path, 401])
      }
    }
    expect(deps.store.listDevices()).toEqual([])
  })

  it('refuses devices when no Entra app is configured', async () => {
    deps.verifier = null
    const response = await createDeviceApp(deps).request('/ingest/v1/devices', { method: 'POST', ...json(registration, await bearer()) })
    expect(response.status).toBe(503)
  })

  it('takes a report from a joined device and shows it judged', async () => {
    const device = await join()
    expect(device.name).toBe('laptop')
    expect((await fleet()).devices[0]).toMatchObject({ level: 'unknown', lastReportAt: null, registeredBy: 'user@example.com' })

    const response = await createDeviceApp(deps).request(`/ingest/v1/devices/${device.id}/report`, { method: 'PUT', ...json(report(), await bearer()) })
    expect(response.status).toBe(200)

    const shown = (await fleet()).devices[0]!
    expect(shown).toMatchObject({ level: 'red', stale: false, intervalMinutes: 15, counts: { red: 1, amber: 0, green: 0, quiet: 0 } })
    expect(shown.repos[0]).toMatchObject({ remoteKey: 'example.org/team/app', level: 'red', signals: [{ kind: 'uncommitted' }] })
  })

  it('turns a device amber when it goes quiet for too long', async () => {
    const device = await join()
    const clean = report({ repos: [] })
    await createDeviceApp(deps).request(`/ingest/v1/devices/${device.id}/report`, { method: 'PUT', ...json(clean, await bearer()) })
    expect((await fleet()).devices[0]).toMatchObject({ level: 'green', stale: false })

    clock += 46 * 60_000
    expect((await fleet()).devices[0]).toMatchObject({ level: 'amber', stale: true })
  })

  it('rejects a report that is not the shape the hub stores', async () => {
    const device = await join()
    const response = await createDeviceApp(deps).request(`/ingest/v1/devices/${device.id}/report`, { method: 'PUT', ...json({ ...report(), repos: 'none' }, await bearer()) })
    expect(response.status).toBe(400)
    expect((await fleet()).devices[0]!.lastReportAt).toBeNull()
  })

  it('lets only the account that joined a device speak for it', async () => {
    const device = await join()
    const stranger = await bearer({ oid: 'user-2', preferred_username: 'other@example.com' })
    const app = createDeviceApp(deps)

    expect((await app.request(`/ingest/v1/devices/${device.id}/report`, { method: 'PUT', ...json(report(), stranger) })).status).toBe(403)
    expect((await app.request(`/ingest/v1/devices/${device.id}`, { method: 'DELETE', headers: stranger })).status).toBe(403)
    expect((await fleet()).devices).toHaveLength(1)
  })

  it('keeps a name given in the hub when the device rejoins without one', async () => {
    const device = await join()
    const session = createSessionApp(deps)
    expect((await session.request(`/api/devices/${device.id}`, { method: 'PATCH', ...json({ name: 'Work laptop' }, signedIn) })).status).toBe(200)

    const rejoined = await createDeviceApp(deps).request(`/ingest/v1/devices/${device.id}`, { method: 'PUT', ...json({ ...registration, version: '0.2.0' }, await bearer()) })
    expect(await rejoined.json()).toEqual({ id: device.id, name: 'Work laptop' })
    expect((await fleet()).devices[0]).toMatchObject({ name: 'Work laptop', version: '0.2.0' })
  })

  it('stops taking reports from a device removed in the hub', async () => {
    const device = await join()
    expect((await createSessionApp(deps).request(`/api/devices/${device.id}`, { method: 'DELETE', headers: signedIn })).status).toBe(200)

    const response = await createDeviceApp(deps).request(`/ingest/v1/devices/${device.id}/report`, { method: 'PUT', ...json(report(), await bearer()) })
    expect(response.status).toBe(404)
    expect((await fleet()).devices).toEqual([])
  })

  it('takes a muted repository out of the device level', async () => {
    const device = await join()
    await createDeviceApp(deps).request(`/ingest/v1/devices/${device.id}/report`, { method: 'PUT', ...json(report(), await bearer()) })

    const muted = await createSessionApp(deps).request(`/api/devices/${device.id}/muted`, { method: 'PUT', ...json({ path: '/src/app', muted: true }, signedIn) })
    expect(muted.status).toBe(200)

    const shown = (await fleet()).devices[0]!
    expect(shown).toMatchObject({ level: 'green', counts: { red: 0, quiet: 1 } })
    expect(shown.repos[0]).toMatchObject({ level: 'quiet', muted: true })
  })
})
