import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DeviceInfo, ScanReport } from '../shared/model.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_report_at TEXT,
  report TEXT
);
CREATE TABLE IF NOT EXISTS muted_repos (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  PRIMARY KEY (device_id, path)
);
`

export interface DeviceRow extends DeviceInfo {
  id: string
  name: string
  /** The Entra object id of whoever signed the device in. Only they may report as it. */
  ownerId: string
  ownerName: string
  createdAt: string
  lastReportAt: string | null
  report: ScanReport | null
}

export interface NewDevice extends DeviceInfo {
  id: string
  name: string
  ownerId: string
  ownerName: string
}

export class Store {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  listDevices(): DeviceRow[] {
    return (this.db.prepare('SELECT * FROM devices ORDER BY name COLLATE NOCASE, created_at').all() as unknown as DeviceRecord[]).map(toDevice)
  }

  getDevice(id: string): DeviceRow | null {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRecord | undefined
    return row ? toDevice(row) : null
  }

  createDevice(device: NewDevice, now: string): void {
    this.db
      .prepare(
        `INSERT INTO devices (id, name, owner_id, owner_name, hostname, os, arch, platform, version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(device.id, device.name, device.ownerId, device.ownerName, device.hostname, device.os, device.arch, device.platform, device.version, now)
  }

  renameDevice(id: string, name: string): void {
    this.db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, id)
  }

  setDeviceInfo(id: string, info: DeviceInfo): void {
    this.db
      .prepare('UPDATE devices SET hostname = ?, os = ?, arch = ?, platform = ?, version = ? WHERE id = ?')
      .run(info.hostname, info.os, info.arch, info.platform, info.version, id)
  }

  /** Replaces the device's picture. Only the latest report is kept. */
  saveReport(id: string, report: ScanReport, now: string): void {
    this.setDeviceInfo(id, report.device)
    this.db.prepare('UPDATE devices SET report = ?, last_report_at = ? WHERE id = ?').run(JSON.stringify(report), now, id)
  }

  /** Removes the device, its report, and its muted repos. */
  deleteDevice(id: string): void {
    this.db.prepare('DELETE FROM devices WHERE id = ?').run(id)
  }

  listMuted(): Map<string, Set<string>> {
    const rows = this.db.prepare('SELECT device_id, path FROM muted_repos').all() as { device_id: string; path: string }[]
    const muted = new Map<string, Set<string>>()
    for (const row of rows) {
      const paths = muted.get(row.device_id) ?? new Set<string>()
      paths.add(row.path)
      muted.set(row.device_id, paths)
    }
    return muted
  }

  setMuted(deviceId: string, path: string, muted: boolean): void {
    if (muted) this.db.prepare('INSERT OR IGNORE INTO muted_repos (device_id, path) VALUES (?, ?)').run(deviceId, path)
    else this.db.prepare('DELETE FROM muted_repos WHERE device_id = ? AND path = ?').run(deviceId, path)
  }
}

interface DeviceRecord {
  id: string
  name: string
  owner_id: string
  owner_name: string
  hostname: string
  os: string
  arch: string
  platform: string
  version: string
  created_at: string
  last_report_at: string | null
  report: string | null
}

function toDevice(row: DeviceRecord): DeviceRow {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    hostname: row.hostname,
    os: row.os,
    arch: row.arch,
    platform: row.platform,
    version: row.version,
    createdAt: row.created_at,
    lastReportAt: row.last_report_at,
    report: row.report ? (JSON.parse(row.report) as ScanReport) : null,
  }
}
