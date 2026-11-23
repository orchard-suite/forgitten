import { serveStatic } from '@hono/node-server/serve-static'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type { FleetResponse, RegisteredDevice, Setup } from '../shared/api.ts'
import type { Config } from './config.ts'
import { TokenRejected, type Caller, type EntraVerifier } from './entra.ts'
import type { Events } from './events.ts'
import { buildFleet } from './fleet.ts'
import type { Logger } from './log.ts'
import { MAX_REPORT_BYTES, registrationSchema, reportSchema } from './report.ts'
import type { DeviceRow, Store } from './store.ts'

export interface HttpDeps {
  config: Config
  store: Store
  events: Events
  /** Null when no Entra app is configured; the device surface then refuses everything. */
  verifier: EntraVerifier | null
  log: Logger
  version: string
  /** Directory holding the built web app, or null to serve the API only. */
  webDir: string | null
  now?: () => number
}

const DEFAULT_AUTHORITY = 'https://login.microsoftonline.com'

/** What a device needs to install the web app as an app of its own. */
const INSTALL_FILES = ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'] as const

const renameSchema = z.object({ name: z.string().trim().min(1).max(100) })
const muteSchema = z.object({ path: z.string().min(1), muted: z.boolean() })

// Session surface ----------------------------------------------------------------

type SessionEnv = { Variables: { user: string } }

/**
 * The web app and its API. Nothing but the health check and the files a device
 * needs to install the app answers without a signed-in person: in `proxy` mode that is whoever the login proxy names in
 * its headers, so this surface must only ever be reachable through that proxy.
 */
export function createSessionApp(deps: HttpDeps): Hono<SessionEnv> {
  const { config, store, events, log } = deps
  const now = deps.now ?? Date.now
  const app = new Hono<SessionEnv>()

  // Every response is private: a copy kept by a shared cache would reach the
  // next visitor without sign-in. Fingerprinted assets may still live in the
  // browser's own cache.
  app.use('*', async (c, next) => {
    await next()
    const immutable = c.req.path.startsWith('/assets/') && c.res.status === 200
    c.res.headers.set('cache-control', immutable ? 'private, max-age=31536000, immutable' : 'private, no-store')
  })

  app.onError((error, c) => {
    log.error('request failed', { method: c.req.method, path: c.req.path, error })
    return c.json({ error: error.message }, 500)
  })

  app.get('/healthz', (c) => c.json({ ok: true }))

  // A device adding the app to a Home Screen or a desktop fetches its icons and
  // manifest without a session, so these answer before the sign-in check.
  if (deps.webDir) {
    for (const file of INSTALL_FILES) app.get(`/${file}`, serveStatic({ root: deps.webDir, path: file }))
  }

  app.use('*', async (c, next) => {
    if (config.AUTH_MODE === 'none') {
      c.set('user', 'local')
      return next()
    }
    const user = c.req.header('x-forwarded-email') ?? c.req.header('x-forwarded-preferred-username') ?? c.req.header('x-forwarded-user')
    if (!user) {
      log.warn('rejected request without a signed-in user', { method: c.req.method, path: c.req.path })
      return c.json({ error: 'Not signed in' }, 401)
    }
    c.set('user', user)
    return next()
  })

  const setup = (): Setup => {
    const { ENTRA_TENANT_ID: tenant, ENTRA_CLIENT_ID: client } = config
    const authority = config.ENTRA_AUTHORITY.replace(/\/+$/, '')
    const extra = authority === DEFAULT_AUTHORITY ? '' : ` --authority ${authority}`
    return {
      configured: Boolean(tenant && client),
      installCommand: config.INSTALL_COMMAND,
      joinCommand: `forgitten fleet join ${config.PUBLIC_URL.replace(/\/+$/, '')} --tenant ${tenant ?? '<tenant-id>'} --client ${client ?? '<client-id>'}${extra} --path ~/source`,
    }
  }

  app.get('/api/fleet', (c) => {
    const at = now()
    return c.json({ generatedAt: new Date(at).toISOString(), user: c.get('user'), version: deps.version, setup: setup(), devices: buildFleet(store, at) } satisfies FleetResponse)
  })

  app.patch('/api/devices/:id', async (c) => {
    const id = c.req.param('id')
    if (!store.getDevice(id)) return c.json({ error: 'Unknown device' }, 404)
    const parsed = renameSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'A name is required' }, 400)
    store.renameDevice(id, parsed.data.name)
    log.info('device renamed', { device: id, name: parsed.data.name, by: c.get('user') })
    events.emit({ type: 'fleet' })
    return c.json({ ok: true })
  })

  app.delete('/api/devices/:id', (c) => {
    const id = c.req.param('id')
    const device = store.getDevice(id)
    if (!device) return c.json({ error: 'Unknown device' }, 404)
    store.deleteDevice(id)
    log.info('device removed', { device: id, name: device.name, by: c.get('user') })
    events.emit({ type: 'fleet' })
    return c.json({ ok: true })
  })

  app.put('/api/devices/:id/muted', async (c) => {
    const id = c.req.param('id')
    if (!store.getDevice(id)) return c.json({ error: 'Unknown device' }, 404)
    const parsed = muteSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'A path and a muted flag are required' }, 400)
    store.setMuted(id, parsed.data.path, parsed.data.muted)
    log.info(parsed.data.muted ? 'repo muted' : 'repo unmuted', { device: id, path: parsed.data.path, by: c.get('user') })
    events.emit({ type: 'fleet' })
    return c.json({ ok: true })
  })

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let n = 0
      const unsubscribe = events.subscribe((event) => void stream.writeSSE({ id: String(++n), event: event.type, data: JSON.stringify(event) }))
      stream.onAbort(unsubscribe)
      // Keep the connection open through idle proxies.
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: '' })
        await stream.sleep(25_000)
      }
    }),
  )

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  if (deps.webDir) {
    const index = readFileSync(`${deps.webDir}/index.html`, 'utf8')
    app.use('/assets/*', serveStatic({ root: deps.webDir }))
    app.get('/favicon.svg', serveStatic({ root: deps.webDir, path: 'favicon.svg' }))
    app.get('*', (c) => c.html(index))
  }

  return app
}

// Device surface -----------------------------------------------------------------

type DeviceEnv = { Variables: { caller: Caller } }

/**
 * What the CLI talks to. Identity comes from an Entra access token and from
 * nothing else: a header that names a person means nothing here.
 */
export function createDeviceApp(deps: HttpDeps): Hono<DeviceEnv> {
  const { store, events, verifier, log } = deps
  const now = deps.now ?? Date.now
  const app = new Hono<DeviceEnv>()

  app.onError((error, c) => {
    log.error('request failed', { method: c.req.method, path: c.req.path, error })
    return c.json({ error: error.message }, 500)
  })

  app.get('/healthz', (c) => c.json({ ok: true }))

  const authenticate: MiddlewareHandler<DeviceEnv> = async (c, next) => {
    if (!verifier) return c.json({ error: 'This hub has no Entra app configured, so devices cannot sign in' }, 503)
    const header = c.req.header('authorization')
    if (!header?.toLowerCase().startsWith('bearer ')) return c.json({ error: 'An Entra access token is required' }, 401)
    try {
      c.set('caller', await verifier.verify(header.slice(7).trim()))
    } catch (error) {
      if (!(error instanceof TokenRejected)) throw error
      log.warn('rejected bearer token', { path: c.req.path, reason: error.message })
      return c.json({ error: `Token rejected: ${error.message}` }, 401)
    }
    return next()
  }
  app.use('/ingest/*', authenticate)

  /** The device, when it exists and the caller is the one who signed it in. */
  const owned = (id: string, caller: Caller): DeviceRow | 404 | 403 => {
    const device = store.getDevice(id)
    if (!device) return 404
    if (device.ownerId !== caller.id) {
      log.warn('rejected call to a device signed in by someone else', { device: id, caller: caller.name })
      return 403
    }
    return device
  }
  const refusal = (status: 404 | 403) => (status === 404 ? 'Unknown device' : 'This device was signed in by someone else')

  app.post('/ingest/v1/devices', async (c) => {
    const parsed = registrationSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: `Invalid device: ${z.prettifyError(parsed.error)}` }, 400)
    const caller = c.get('caller')
    const { name, ...info } = parsed.data
    const device = { ...info, id: randomUUID(), name: name ?? info.hostname, ownerId: caller.id, ownerName: caller.name }
    store.createDevice(device, new Date(now()).toISOString())
    log.info('device joined', { device: device.id, name: device.name, by: caller.name })
    events.emit({ type: 'fleet' })
    return c.json({ id: device.id, name: device.name } satisfies RegisteredDevice, 201)
  })

  app.put('/ingest/v1/devices/:id', async (c) => {
    const device = owned(c.req.param('id'), c.get('caller'))
    if (typeof device === 'number') return c.json({ error: refusal(device) }, device)
    const parsed = registrationSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: `Invalid device: ${z.prettifyError(parsed.error)}` }, 400)
    const { name, ...info } = parsed.data
    store.setDeviceInfo(device.id, info)
    if (name) store.renameDevice(device.id, name)
    log.info('device rejoined', { device: device.id, name: name ?? device.name })
    events.emit({ type: 'fleet' })
    return c.json({ id: device.id, name: name ?? device.name } satisfies RegisteredDevice)
  })

  app.put('/ingest/v1/devices/:id/report', bodyLimit({ maxSize: MAX_REPORT_BYTES, onError: (c) => c.json({ error: 'Report too large' }, 413) }), async (c) => {
    const device = owned(c.req.param('id'), c.get('caller'))
    if (typeof device === 'number') return c.json({ error: refusal(device) }, device)
    const parsed = reportSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      log.warn('rejected report', { device: device.id, reason: z.prettifyError(parsed.error) })
      return c.json({ error: `Invalid report: ${z.prettifyError(parsed.error)}` }, 400)
    }
    const receivedAt = new Date(now()).toISOString()
    store.saveReport(device.id, parsed.data, receivedAt)
    log.info('report received', { device: device.id, name: device.name, repos: parsed.data.repos.length, scanMs: parsed.data.durationMs })
    events.emit({ type: 'fleet' })
    return c.json({ receivedAt })
  })

  app.delete('/ingest/v1/devices/:id', (c) => {
    const device = owned(c.req.param('id'), c.get('caller'))
    if (typeof device === 'number') return c.json({ error: refusal(device) }, device)
    store.deleteDevice(device.id)
    log.info('device left', { device: device.id, name: device.name })
    events.emit({ type: 'fleet' })
    return c.body(null, 204)
  })

  app.all('*', (c) => c.json({ error: 'Not found' }, 404))

  return app
}
