import { z } from 'zod'
import type { DeviceRegistration } from '../shared/api.ts'
import type { ScanReport } from '../shared/model.ts'

// What a device may send. The bounds are generous for a real machine and
// small enough that one request cannot fill the disk.

const text = z.string().max(4096)
const count = z.number().int().min(0)

const device = z.object({
  hostname: text.min(1),
  os: text,
  arch: text,
  platform: text,
  version: text,
})

const branch = z.object({
  name: text,
  upstream: text.nullable(),
  upstreamGone: z.boolean(),
  ahead: count,
  behind: count,
  unpushed: count,
})

const worktree = z.object({
  path: text,
  branch: text.nullable(),
  head: text,
  main: z.boolean(),
  staged: count,
  modified: count,
  untracked: count,
  conflicted: count,
})

const repo = z.object({
  path: text.min(1),
  name: text,
  remoteUrl: text.nullable(),
  stashes: count,
  worktrees: z.array(worktree).max(2000),
  branches: z.array(branch).max(20_000),
  error: text.nullable(),
})

export const reportSchema: z.ZodType<ScanReport> = z.object({
  schema: z.literal(1),
  scannedAt: z.iso.datetime({ offset: true }),
  durationMs: count,
  roots: z.array(text).max(200),
  ignore: z.array(text).max(200),
  intervalMinutes: z.number().int().positive().nullable(),
  device,
  repos: z.array(repo).max(20_000),
})

export const registrationSchema: z.ZodType<DeviceRegistration> = device.extend({
  name: z.string().trim().min(1).max(100).nullable(),
})

export const MAX_REPORT_BYTES = 16 * 1024 * 1024
