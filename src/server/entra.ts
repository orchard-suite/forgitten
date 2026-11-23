import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Config } from './config.ts'

/** The person a device signed in as. */
export interface Caller {
  /** Entra object id: stable for the account, whatever its name becomes. */
  id: string
  name: string
}

export class TokenRejected extends Error {}

/**
 * Checks that a bearer token is an access token Entra issued, in this tenant,
 * for this app, with the device scope. Nothing else is taken as proof.
 */
export class EntraVerifier {
  private readonly issuer: string
  private readonly keys: JWTVerifyGetKey
  private readonly tenantId: string
  private readonly clientId: string
  private readonly scope: string

  constructor(config: Pick<Config, 'ENTRA_AUTHORITY' | 'ENTRA_SCOPE'> & { ENTRA_TENANT_ID: string; ENTRA_CLIENT_ID: string }) {
    const authority = config.ENTRA_AUTHORITY.replace(/\/+$/, '')
    this.tenantId = config.ENTRA_TENANT_ID
    this.clientId = config.ENTRA_CLIENT_ID
    this.scope = config.ENTRA_SCOPE
    this.issuer = `${authority}/${this.tenantId}/v2.0`
    this.keys = createRemoteJWKSet(new URL(`${authority}/${this.tenantId}/discovery/v2.0/keys`))
  }

  async verify(token: string): Promise<Caller> {
    let claims
    try {
      claims = (await jwtVerify(token, this.keys, { issuer: this.issuer, audience: this.clientId, algorithms: ['RS256'] })).payload
    } catch (error) {
      throw new TokenRejected(error instanceof Error ? error.message : String(error))
    }
    if (claims.tid !== this.tenantId) throw new TokenRejected('token is from another tenant')
    const scopes = typeof claims.scp === 'string' ? claims.scp.split(' ') : []
    if (!scopes.includes(this.scope)) throw new TokenRejected(`token lacks the ${this.scope} scope`)
    const id = typeof claims.oid === 'string' ? claims.oid : claims.sub
    if (!id) throw new TokenRejected('token names no account')
    const name = typeof claims.preferred_username === 'string' ? claims.preferred_username : typeof claims.name === 'string' ? claims.name : id
    return { id, name }
  }
}
