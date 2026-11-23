// Runs a hub on a made-up fleet, for screenshots and for trying the web app
// without any devices. Nothing here comes from a real machine.
//
//   npm run build && node scripts/demo-fleet.ts     # then open http://localhost:8080
//
// The README hero is the Fleet page at 1440 wide, cropped below the device cards.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BranchReport, DeviceInfo, RepoReport, ScanReport } from '../src/shared/model.ts'
import { Store } from '../src/server/store.ts'

interface Work {
  remote?: string | null
  branch?: string
  modified?: number
  untracked?: number
  staged?: number
  stashes?: number
  branches?: Partial<BranchReport>[]
}

const repo = (root: string, name: string, work: Work = {}): RepoReport => {
  const branch = work.branch ?? 'main'
  return {
    path: `${root}/${name}`,
    name,
    remoteUrl: work.remote === undefined ? `git@github.com:example/${name}.git` : work.remote,
    stashes: work.stashes ?? 0,
    worktrees: [{ path: `${root}/${name}`, branch, head: 'a1b2c3d', main: true, staged: work.staged ?? 0, modified: work.modified ?? 0, untracked: work.untracked ?? 0, conflicted: 0 }],
    branches: (work.branches ?? [{}]).map((b) => ({ name: branch, upstream: `origin/${b.name ?? branch}`, upstreamGone: false, ahead: 0, behind: 0, unpushed: 0, ...b })),
    error: null,
  }
}

const clean = (root: string, ...names: string[]) => names.map((name) => repo(root, name))

interface DemoDevice {
  name: string
  device: DeviceInfo
  intervalMinutes: number
  minutesAgo: number
  repos: RepoReport[]
}

const version = '0.1.1'
const mac = '/Users/dev/source'
const linux = '/home/dev/src'
const windows = 'C:\\Users\\dev\\source'

const devices: DemoDevice[] = [
  {
    name: 'studio-mac',
    device: { hostname: 'studio-mac', os: 'macos', arch: 'arm64', platform: 'Darwin 25.1.0', version },
    intervalMinutes: 15,
    minutesAgo: 4,
    repos: [
      repo(mac, 'billing-api', { branch: 'feat/invoice-export', modified: 6, untracked: 2, branches: [{ name: 'feat/invoice-export', unpushed: 3 }] }),
      repo(mac, 'design-tokens', { modified: 3 }),
      repo(mac, 'side-project', { remote: null, branches: [{ upstream: null }] }),
      repo(mac, 'web-app', { stashes: 2 }),
      repo(mac, 'infra', { branch: 'fix/dns-ttl', staged: 1, branches: [{ name: 'fix/dns-ttl', upstream: null, unpushed: 1 }] }),
      ...clean(mac, 'docs-site', 'mobile', 'auth-service', 'search', 'cli-tools', 'dotfiles', 'notifications'),
    ],
  },
  {
    name: 'build-box',
    device: { hostname: 'build-box', os: 'linux', arch: 'x64', platform: 'Ubuntu 24.04.3 LTS', version },
    intervalMinutes: 30,
    minutesAgo: 11,
    repos: [
      repo(linux, 'ci-runners', { branches: [{ unpushed: 4 }] }),
      repo(linux, 'release-scripts', { stashes: 1 }),
      ...clean(linux, 'billing-api', 'web-app', 'infra', 'search', 'base-images'),
    ],
  },
  {
    name: 'old-thinkpad',
    device: { hostname: 'OLD-THINKPAD', os: 'windows', arch: 'x64', platform: 'Microsoft Windows 10.0.19045', version },
    intervalMinutes: 60,
    minutesAgo: 9 * 24 * 60,
    repos: [
      repo(windows, 'thesis', { remote: null, modified: 4, untracked: 1, branches: [{ upstream: null }] }),
      repo(windows, 'game-jam', { branches: [{ unpushed: 12 }] }),
      ...clean(windows, 'dotfiles', 'web-app'),
    ],
  },
]

const dataDir = process.env.DATA_DIR ?? mkdtempSync(join(tmpdir(), 'forgitten-demo-'))
const store = new Store(join(dataDir, 'forgitten.sqlite'))
for (const demo of devices) {
  if (store.listDevices().some((d) => d.name === demo.name)) continue
  const id = crypto.randomUUID()
  const at = new Date(Date.now() - demo.minutesAgo * 60_000).toISOString()
  store.createDevice({ ...demo.device, id, name: demo.name, ownerId: 'demo', ownerName: 'user@example.com' }, at)
  const report: ScanReport = {
    schema: 1,
    scannedAt: at,
    durationMs: 840,
    roots: [demo.repos[0]!.path.replace(/[\\/][^\\/]+$/, '')],
    ignore: [],
    intervalMinutes: demo.intervalMinutes,
    device: demo.device,
    repos: demo.repos,
  }
  store.saveReport(id, report, at)
}
store.close()

process.env.DATA_DIR = dataDir
process.env.AUTH_MODE = 'none'
await import('../src/server/main.ts')
