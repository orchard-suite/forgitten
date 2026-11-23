import { describe, expect, it } from 'vitest'
import { remoteKey, type BranchReport, type RepoReport, type ScanReport, type WorktreeReport } from './model.ts'
import { evaluateRepo, isStale } from './rules.ts'

const branch = (over: Partial<BranchReport> = {}): BranchReport => ({ name: 'main', upstream: 'origin/main', upstreamGone: false, ahead: 0, behind: 0, unpushed: 0, ...over })
const worktree = (over: Partial<WorktreeReport> = {}): WorktreeReport => ({ path: '/src/app', branch: 'main', head: 'abc1234', main: true, staged: 0, modified: 0, untracked: 0, conflicted: 0, ...over })
const repo = (over: Partial<RepoReport> = {}): RepoReport => ({
  path: '/src/app',
  name: 'src/app',
  remoteUrl: 'git@example.org:team/app.git',
  stashes: 0,
  worktrees: [worktree()],
  branches: [branch()],
  error: null,
  ...over,
})

describe('evaluateRepo', () => {
  it('is green when everything is pushed', () => {
    expect(evaluateRepo(repo())).toEqual({ level: 'green', signals: [] })
  })

  it('is red for uncommitted files, in any worktree', () => {
    const health = evaluateRepo(repo({ worktrees: [worktree(), worktree({ path: '/wt/app-fix', branch: 'fix', main: false, modified: 2, untracked: 1 })] }))
    expect(health.level).toBe('red')
    expect(health.signals.map((s) => s.text)).toEqual(['3 uncommitted files on fix in worktree app-fix'])
  })

  it('is red for commits no remote holds, with or without an upstream', () => {
    const health = evaluateRepo(repo({ branches: [branch({ ahead: 2, unpushed: 2 }), branch({ name: 'spike', upstream: null, unpushed: 1 })] }))
    expect(health.level).toBe('red')
    expect(health.signals.map((s) => s.kind)).toEqual(['unpushed', 'unpushed'])
  })

  it('stays green when a branch is only behind, or its merged upstream was deleted', () => {
    const health = evaluateRepo(repo({ branches: [branch({ behind: 4 }), branch({ name: 'done', upstream: 'origin/done', upstreamGone: true })] }))
    expect(health.level).toBe('green')
    expect(health.signals.map((s) => [s.kind, s.severity])).toEqual([
      ['behind', 'info'],
      ['upstream-gone', 'info'],
    ])
  })

  it('is amber for stashes, a missing remote, and a repository git could not read', () => {
    expect(evaluateRepo(repo({ stashes: 2 })).level).toBe('amber')
    expect(evaluateRepo(repo({ remoteUrl: null })).signals.map((s) => s.kind)).toEqual(['no-remote'])
    expect(evaluateRepo(repo({ error: 'detected dubious ownership', worktrees: [], branches: [] }))).toMatchObject({ level: 'amber', signals: [{ kind: 'error' }] })
  })
})

describe('isStale', () => {
  const report = (intervalMinutes: number | null) => ({ intervalMinutes }) as ScanReport
  const at = Date.parse('2026-01-01T12:00:00Z')
  const minutesAgo = (m: number) => new Date(at - m * 60_000).toISOString()

  it('allows three missed intervals', () => {
    expect(isStale(report(15), minutesAgo(44), at)).toBe(false)
    expect(isStale(report(15), minutesAgo(46), at)).toBe(true)
  })

  it('gives a device without a schedule a day', () => {
    expect(isStale(report(null), minutesAgo(23 * 60), at)).toBe(false)
    expect(isStale(report(null), minutesAgo(25 * 60), at)).toBe(true)
  })
})

describe('remoteKey', () => {
  it('names the same repository the same way for every protocol', () => {
    for (const url of ['git@Example.org:Team/App.git', 'https://example.org/team/app', 'https://example.org/team/app.git/', 'ssh://git@example.org/team/app.git']) {
      expect(remoteKey(url)).toBe('example.org/team/app')
    }
  })

  it('has no key without a remote or for a local path', () => {
    expect(remoteKey(null)).toBeNull()
    expect(remoteKey('/srv/git/app.git')).toBeNull()
  })
})
