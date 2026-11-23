import type { DeviceView, LevelCounts, RepoView } from '../shared/api.ts'
import { remoteKey } from '../shared/model.ts'
import { evaluateRepo, isStale, staleAfterMinutes, worst, type Level } from '../shared/rules.ts'
import type { DeviceRow, Store } from './store.ts'

/** Turns stored reports into what the board shows. Health is judged here, at read time. */
export function buildFleet(store: Store, now: number): DeviceView[] {
  const muted = store.listMuted()
  return store.listDevices().map((device) => toView(device, muted.get(device.id) ?? new Set(), now))
}

function toView(device: DeviceRow, muted: Set<string>, now: number): DeviceView {
  const report = device.report
  const repos: RepoView[] = (report?.repos ?? []).map((repo) => {
    const health = evaluateRepo(repo)
    const isMuted = muted.has(repo.path)
    return { ...repo, remoteKey: remoteKey(repo.remoteUrl), muted: isMuted, level: isMuted ? 'quiet' : health.level, signals: health.signals }
  })

  const counts: LevelCounts = { red: 0, amber: 0, green: 0, quiet: 0 }
  for (const repo of repos) if (repo.level !== 'unknown') counts[repo.level]++

  const stale = report !== null && device.lastReportAt !== null && isStale(report, device.lastReportAt, now)
  let level: Level = report ? worst(repos.map((r) => r.level)) : 'unknown'
  // A stale device's last picture may still be red; it is never better than amber.
  if (stale && level === 'green') level = 'amber'

  return {
    id: device.id,
    name: device.name,
    hostname: device.hostname,
    os: device.os,
    arch: device.arch,
    platform: device.platform,
    version: device.version,
    registeredBy: device.ownerName,
    createdAt: device.createdAt,
    lastReportAt: device.lastReportAt,
    stale,
    staleAfterMinutes: report ? staleAfterMinutes(report) : null,
    intervalMinutes: report?.intervalMinutes ?? null,
    scanDurationMs: report?.durationMs ?? null,
    roots: report?.roots ?? [],
    ignore: report?.ignore ?? [],
    level,
    counts,
    repos,
  }
}
