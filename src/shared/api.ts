// Wire types between the server and the web app.

import type { RepoReport } from './model.ts'
import type { Level, Signal } from './rules.ts'

/** One repository on one device, judged. */
export interface RepoView extends RepoReport {
  /** Groups copies of the same repository across devices; null without a usable remote. */
  remoteKey: string | null
  level: Level
  muted: boolean
  signals: Signal[]
}

export type LevelCounts = Record<'red' | 'amber' | 'green' | 'quiet', number>

export interface DeviceView {
  id: string
  name: string
  hostname: string
  os: string
  arch: string
  platform: string
  version: string
  /** Who signed the device in. */
  registeredBy: string
  createdAt: string
  lastReportAt: string | null
  /** No report for longer than the device's own schedule allows. */
  stale: boolean
  /** Minutes of silence that make it stale; null until the first report. */
  staleAfterMinutes: number | null
  intervalMinutes: number | null
  scanDurationMs: number | null
  roots: string[]
  ignore: string[]
  level: Level
  counts: LevelCounts
  repos: RepoView[]
}

/** What a person needs to add a device. */
export interface Setup {
  /** False until the hub knows its Entra tenant and client; devices cannot sign in before that. */
  configured: boolean
  joinCommand: string
  installCommand: string
}

export interface FleetResponse {
  generatedAt: string
  user: string
  version: string
  setup: Setup
  devices: DeviceView[]
}

export type ServerEvent = { type: 'fleet' }

// The device API, spoken by the CLI.

export interface DeviceRegistration {
  /** Null keeps the name the hub has, or takes the host name for a new device. */
  name: string | null
  hostname: string
  os: string
  arch: string
  platform: string
  version: string
}

export interface RegisteredDevice {
  id: string
  name: string
}
