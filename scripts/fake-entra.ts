// A stand-in for Microsoft Entra, for tests and for trying the device flow on
// your own machine without a tenant. It signs tokens with a key made at start,
// serves that key where the hub looks for it, and approves every device code.
//
//   node scripts/fake-entra.ts            # prints the settings to run a hub and a CLI against it

import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'

export interface FakeEntra {
  authority: string
  tenantId: string
  clientId: string
  /** Signs an access token. Override claims to make a bad one. */
  issue(claims?: Record<string, unknown>, options?: { expiresIn?: string; key?: CryptoKey }): Promise<string>
  /** How many times a refresh token has been redeemed. */
  refreshes: number
  close(): Promise<void>
}

export async function startFakeEntra(port = 0): Promise<FakeEntra> {
  const tenantId = '11111111-1111-1111-1111-111111111111'
  const clientId = '22222222-2222-2222-2222-222222222222'
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'fake-1', use: 'sig', alg: 'RS256' }

  let authority = ''
  let refreshToken = randomUUID()
  const pending = new Set<string>()

  const fake: FakeEntra = {
    authority: '',
    tenantId,
    clientId,
    refreshes: 0,
    issue: (claims = {}, options = {}) =>
      new SignJWT({ iss: `${authority}/${tenantId}/v2.0`, aud: clientId, tid: tenantId, oid: 'user-1', preferred_username: 'user@example.com', scp: 'Fleet.Report', ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'fake-1' })
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '1h')
        .sign(options.key ?? privateKey),
    close: () => new Promise((done) => server.close(() => done())),
  }

  const app = new Hono()
  app.get('/:tenant/discovery/v2.0/keys', (c) => c.json({ keys: [jwk] }))

  app.post('/:tenant/oauth2/v2.0/devicecode', (c) => {
    const code = randomUUID()
    pending.add(code)
    return c.json({
      device_code: code,
      user_code: 'FAKE-CODE',
      verification_uri: `${authority}/device`,
      expires_in: 60,
      interval: 1,
      message: `Fake Entra: no browser needed, the code FAKE-CODE approves itself.`,
    })
  })

  app.post('/:tenant/oauth2/v2.0/token', async (c) => {
    const form = await c.req.parseBody()
    if (form.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      if (!pending.delete(String(form.device_code))) return c.json({ error: 'expired_token' }, 400)
    } else if (form.grant_type === 'refresh_token') {
      if (form.refresh_token !== refreshToken) return c.json({ error: 'invalid_grant', error_description: 'The refresh token is not the latest one.' }, 400)
      fake.refreshes++
    } else {
      return c.json({ error: 'unsupported_grant_type' }, 400)
    }
    // Rotates on every use, as Entra does.
    refreshToken = randomUUID()
    return c.json({ token_type: 'Bearer', expires_in: 3600, access_token: await fake.issue(), refresh_token: refreshToken })
  })

  let server!: ServerType
  await new Promise<void>((ready) => {
    server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => ready())
  })
  authority = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fake.authority = authority
  return fake
}

if (import.meta.main) {
  const fake = await startFakeEntra(Number(process.env.FAKE_ENTRA_PORT ?? 8099))
  console.log(`Fake Entra on ${fake.authority}

Hub:  ENTRA_AUTHORITY=${fake.authority} ENTRA_TENANT_ID=${fake.tenantId} ENTRA_CLIENT_ID=${fake.clientId} npm run dev:server
CLI:  forgitten fleet join http://localhost:8081 --authority ${fake.authority} --tenant ${fake.tenantId} --client ${fake.clientId} --path ~/source`)
}
