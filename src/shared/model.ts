// The scan report a device sends. The CLI writes this shape; the hub stores it
// as sent and judges it at read time.

/** One local branch and how it stands against the remotes. */
export interface BranchReport {
  name: string
  /** The tracked branch, like `origin/main`, or null when none is set. */
  upstream: string | null
  /** An upstream is set but no longer exists on the remote. */
  upstreamGone: boolean
  ahead: number
  behind: number
  /** Commits on this branch that no remote branch holds. */
  unpushed: number
}

/** One checkout of a repository: the main one, or a linked worktree. */
export interface WorktreeReport {
  path: string
  /** The checked out branch, or null when HEAD is detached. */
  branch: string | null
  /** Short commit id, or empty before the first commit. */
  head: string
  main: boolean
  staged: number
  modified: number
  untracked: number
  conflicted: number
}

export interface RepoReport {
  /** The main worktree. A device reports each path once. */
  path: string
  name: string
  /** The origin URL without credentials, or null when the repository has no remote. */
  remoteUrl: string | null
  stashes: number
  worktrees: WorktreeReport[]
  branches: BranchReport[]
  /** Why git could not read this repository. */
  error: string | null
}

/** What a device says about itself. */
export interface DeviceInfo {
  hostname: string
  os: string
  arch: string
  platform: string
  version: string
}

export interface ScanReport {
  schema: 1
  scannedAt: string
  durationMs: number
  roots: string[]
  ignore: string[]
  /** How often the device reports, or null when it has no schedule installed. */
  intervalMinutes: number | null
  device: DeviceInfo
  repos: RepoReport[]
}

/**
 * The same repository on two devices, whatever protocol each cloned it with:
 * `git@host:team/app.git` and `https://host/team/app` both give `host/team/app`.
 */
export function remoteKey(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(remoteUrl)
  let host: string
  let path: string
  if (scp) {
    host = scp[1]!
    path = scp[2]!
  } else {
    try {
      const url = new URL(remoteUrl)
      if (!url.host) return null
      host = url.hostname
      path = url.pathname
    } catch {
      return null
    }
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  return path ? `${host}/${path}`.toLowerCase() : null
}
