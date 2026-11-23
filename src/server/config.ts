import { z } from 'zod'

const schema = z
  .object({
    /** The session surface: the web app and its API. Only a login proxy may reach it. */
    PORT: z.coerce.number().int().positive().default(8080),
    HOST: z.string().default('0.0.0.0'),
    /** The device surface: reports from the CLI. Entra bearer tokens only. */
    INGEST_PORT: z.coerce.number().int().positive().default(8081),
    INGEST_HOST: z.string().default('0.0.0.0'),
    DATA_DIR: z.string().default('./data'),
    /** The URL a browser and a device reach this instance on. */
    PUBLIC_URL: z.string().url().default('http://localhost:8080'),
    /**
     * `proxy`: a login proxy in front of the session surface vouches for the person through headers.
     * `none`: no login at all, for running on your own machine.
     */
    AUTH_MODE: z.enum(['proxy', 'none']).default('proxy'),
    /** The command the Add device page shows for installing the CLI. Change it to install from your own mirror. */
    INSTALL_COMMAND: z.string().default('curl -fsSL https://raw.githubusercontent.com/orchard-suite/forgitten/main/install.sh | bash'),
    /** The Entra tenant and app registration devices sign in to. */
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    /** The scope a device's token must carry. */
    ENTRA_SCOPE: z.string().default('Fleet.Report'),
    /** Entra sign-in host. Change it for a sovereign cloud. */
    ENTRA_AUTHORITY: z.string().url().default('https://login.microsoftonline.com'),
  })
  .refine((c) => c.AUTH_MODE === 'none' || (c.ENTRA_TENANT_ID && c.ENTRA_CLIENT_ID), {
    message: 'ENTRA_TENANT_ID and ENTRA_CLIENT_ID are required unless AUTH_MODE=none',
    path: ['ENTRA_TENANT_ID'],
  })

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  return parsed.data
}
