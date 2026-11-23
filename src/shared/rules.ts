// The only place a reason to not be green is defined. The server and the web
// app both import it, and nothing is stored: a rule change shows on the next read.

import type { RepoReport, ScanReport } from './model.ts'

/** `quiet` is a muted repository; `unknown` is a device that has not reported yet. */
export type Level = 'red' | 'amber' | 'green' | 'quiet' | 'unknown'
export type Severity = 'red' | 'amber' | 'info'

export type SignalKind = 'uncommitted' | 'unpushed' | 'no-remote' | 'stash' | 'error' | 'upstream-gone' | 'ahead' | 'behind' | 'stale'

export interface Signal {
  kind: SignalKind
  severity: Severity
  text: string
}

export interface RepoHealth {
  level: Exclude<Level, 'quiet' | 'unknown'>
  signals: Signal[]
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Red is work that exists only on this device and is gone if the device is.
 * Amber is worth a look. Info never changes the level.
 */
export function evaluateRepo(repo: RepoReport): RepoHealth {
  const signals: Signal[] = []

  if (repo.error) {
    signals.push({ kind: 'error', severity: 'amber', text: `git could not read it: ${repo.error}` })
    return { level: 'amber', signals }
  }

  for (const w of repo.worktrees) {
    const changed = w.staged + w.modified + w.untracked + w.conflicted
    if (changed === 0) continue
    const where = w.branch ?? `detached ${w.head}`
    const place = w.main ? where : `${where} in worktree ${basename(w.path)}`
    const conflicts = w.conflicted > 0 ? `, ${w.conflicted} in conflict` : ''
    signals.push({ kind: 'uncommitted', severity: 'red', text: `${count(changed, 'uncommitted file')} on ${place}${conflicts}` })
  }

  const hasRemote = repo.remoteUrl !== null
  if (!hasRemote) signals.push({ kind: 'no-remote', severity: 'amber', text: 'No remote: every commit lives only on this device' })

  for (const b of repo.branches) {
    if (b.unpushed > 0) {
      signals.push({ kind: 'unpushed', severity: 'red', text: `${count(b.unpushed, 'commit')} on ${b.name} ${b.unpushed === 1 ? 'is' : 'are'} on no remote` })
    } else if (b.upstreamGone) {
      signals.push({ kind: 'upstream-gone', severity: 'info', text: `${b.name}: its remote branch was deleted and nothing is unpushed` })
    } else if (b.ahead > 0) {
      signals.push({ kind: 'ahead', severity: 'info', text: `${b.name} is ${b.ahead} ahead of ${b.upstream}, already on another remote branch` })
    }
    if (b.behind > 0 && !b.upstreamGone) signals.push({ kind: 'behind', severity: 'info', text: `${b.name} is ${b.behind} behind ${b.upstream}` })
  }

  if (repo.stashes > 0) signals.push({ kind: 'stash', severity: 'amber', text: count(repo.stashes, 'stash', 'stashes') })

  const level = signals.some((s) => s.severity === 'red') ? 'red' : signals.some((s) => s.severity === 'amber') ? 'amber' : 'green'
  return { level, signals }
}

/** A device with no schedule is expected to report at least daily. */
const UNSCHEDULED_MINUTES = 24 * 60

/** Minutes of silence after which a device's picture is too old to trust. */
export function staleAfterMinutes(report: ScanReport): number {
  return report.intervalMinutes === null ? UNSCHEDULED_MINUTES : Math.max(report.intervalMinutes * 3, 10)
}

export function isStale(report: ScanReport, lastReportAt: string, now: number): boolean {
  return now - Date.parse(lastReportAt) > staleAfterMinutes(report) * 60_000
}

export function worst(levels: Level[]): Level {
  for (const level of ['red', 'amber', 'green'] as const) if (levels.includes(level)) return level
  return 'green'
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
