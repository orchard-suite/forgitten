import { serve } from '@hono/node-server'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from './config.ts'
import { EntraVerifier } from './entra.ts'
import { Events } from './events.ts'
import { createDeviceApp, createSessionApp } from './http.ts'
import { createLogger } from './log.ts'
import { Store } from './store.ts'

const log = createLogger('forgitten')
const config = loadConfig()
const dataDir = resolve(config.DATA_DIR)
const version = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string }).version

const store = new Store(join(dataDir, 'forgitten.sqlite'))
const events = new Events()

const { ENTRA_TENANT_ID, ENTRA_CLIENT_ID } = config
const verifier = ENTRA_TENANT_ID && ENTRA_CLIENT_ID ? new EntraVerifier({ ...config, ENTRA_TENANT_ID, ENTRA_CLIENT_ID }) : null
if (verifier) log.info('device sign-in configured', { tenant: ENTRA_TENANT_ID, client: ENTRA_CLIENT_ID, scope: config.ENTRA_SCOPE })
else log.warn('no Entra app configured; devices cannot report until ENTRA_TENANT_ID and ENTRA_CLIENT_ID are set')
if (config.AUTH_MODE === 'none') log.warn('AUTH_MODE=none: the web app answers anyone who can reach it; use it only on your own machine')

const webDir = resolve(import.meta.dirname, '../../dist/web')
const deps = { config, store, events, verifier, version, webDir: existsSync(webDir) ? webDir : null }

const session = serve({ fetch: createSessionApp({ ...deps, log: createLogger('session') }).fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  log.info('session surface listening', { host: info.address, port: info.port, authMode: config.AUTH_MODE, publicUrl: config.PUBLIC_URL, web: deps.webDir !== null, dataDir, version })
})
const device = serve({ fetch: createDeviceApp({ ...deps, log: createLogger('device') }).fetch, port: config.INGEST_PORT, hostname: config.INGEST_HOST }, (info) => {
  log.info('device surface listening', { host: info.address, port: info.port })
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('shutting down', { signal })
    let open = 2
    const closed = () => {
      if (--open > 0) return
      store.close()
      process.exit(0)
    }
    session.close(closed)
    device.close(closed)
    // Open event streams would otherwise hold the server open indefinitely.
    if ('closeAllConnections' in session) session.closeAllConnections()
    if ('closeAllConnections' in device) device.closeAllConnections()
  })
}
