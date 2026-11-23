import type { DeviceView, FleetResponse } from '../../shared/api.ts'
import { ago } from '../format.ts'
import { RepoRow } from './RepoRow.tsx'
import { Counts, Empty, Kicker, LEVEL_TEXT, Lamp, Link, Panel } from './ui.tsx'

export function Fleet({ fleet }: { fleet: FleetResponse }) {
  const { devices } = fleet
  if (devices.length === 0) {
    return (
      <div className="flex flex-col gap-8 pt-10">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">No devices yet.</h1>
        <Empty>
          Add the first machine and its repositories show up here within a minute.{' '}
          <Link to={{ page: 'add' }} className="text-ink-100 underline underline-offset-4">
            Add a device
          </Link>
        </Empty>
      </div>
    )
  }

  const atRisk = devices.flatMap((device) => device.repos.filter((r) => r.level === 'red').map((repo) => ({ device, repo })))

  return (
    <div className="flex flex-col gap-10 pt-10">
      <Headline devices={devices} atRisk={atRisk.length} />

      <div className="flex flex-col gap-3">
        <Kicker>Devices</Kicker>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      </div>

      {atRisk.length > 0 && (
        <div className="flex flex-col gap-3">
          <Kicker>Only on one machine</Kicker>
          <Panel>
            {atRisk.map(({ device, repo }) => (
              <RepoRow
                key={`${device.id}:${repo.path}`}
                deviceId={device.id}
                repo={repo}
                lead={<span className="w-28 shrink-0 truncate font-mono text-[10px] uppercase tracking-wide text-ink-400">{device.name}</span>}
              />
            ))}
          </Panel>
        </div>
      )}
    </div>
  )
}

function Headline({ devices, atRisk }: { devices: DeviceView[]; atRisk: number }) {
  const live = devices.flatMap((d) => d.repos.filter((r) => !r.muted))
  const files = live.reduce((n, r) => n + r.worktrees.reduce((m, w) => m + w.staged + w.modified + w.untracked + w.conflicted, 0), 0)
  const commits = live.reduce((n, r) => n + r.branches.reduce((m, b) => m + b.unpushed, 0), 0)
  const stashes = live.reduce((n, r) => n + r.stashes, 0)
  const quiet = devices.filter((d) => d.stale || d.lastReportAt === null).length
  const holders = devices.filter((d) => d.counts.red > 0).length

  return (
    <div className="flex flex-col gap-6">
      <h1 className="max-w-4xl text-4xl leading-[1.05] font-semibold tracking-tight md:text-6xl">
        {atRisk > 0 ? (
          <>
            <span className="text-red">{atRisk}</span> {atRisk === 1 ? 'repo holds' : 'repos hold'} work that exists nowhere else.
          </>
        ) : (
          <>
            Nothing forgotten. <span className="text-ink-400">Every commit is on a remote.</span>
          </>
        )}
      </h1>
      <div className="flex flex-wrap gap-x-10 gap-y-4 border-t border-ink-700 pt-5">
        <Stat label="Devices" value={devices.length} note={quiet > 0 ? `${quiet} gone quiet` : holders > 0 ? `${holders} holding work` : 'all reporting'} warn={quiet > 0} />
        <Stat label="Repos" value={live.length} />
        <Stat label="Uncommitted files" value={files} />
        <Stat label="Unpushed commits" value={commits} />
        <Stat label="Stashes" value={stashes} />
      </div>
    </div>
  )
}

function Stat({ label, value, note, warn }: { label: string; value: number; note?: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <Kicker>{label}</Kicker>
      <div className="font-mono text-2xl text-ink-100">{value.toLocaleString()}</div>
      {note && <div className={`font-mono text-[10px] ${warn ? 'text-amber' : 'text-ink-400'}`}>{note}</div>}
    </div>
  )
}

function DeviceCard({ device }: { device: DeviceView }) {
  const worst = device.repos.filter((r) => r.level === 'red' || r.level === 'amber').slice(0, 3)
  return (
    <Link to={{ page: 'device', id: device.id }} className="group flex min-w-0 flex-col gap-4 rounded-md border border-ink-700 bg-ink-900/70 p-5 transition-colors hover:border-ink-400">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Lamp level={device.level} size="lg" />
            <span className="truncate text-xl font-semibold tracking-tight">{device.name}</span>
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-ink-400">
            {device.os} · {device.arch} · v{device.version}
          </div>
        </div>
        <Counts counts={device.counts} />
      </div>

      <div className="rule-line h-px" />

      {device.lastReportAt === null ? (
        <p className="text-sm text-ink-400">Joined, but has not reported yet.</p>
      ) : worst.length === 0 ? (
        <p className="text-sm text-ink-400">Nothing here needs you.</p>
      ) : (
        <ul className="grid gap-1.5">
          {worst.map((repo) => (
            <li key={repo.path} className="flex min-w-0 items-center gap-2 text-sm">
              <Lamp level={repo.level} size="sm" />
              <span className="max-w-[60%] shrink-0 truncate font-mono text-xs text-ink-200">{repo.name.split('/').at(-1)}</span>
              <span className="min-w-0 truncate text-ink-400">{repo.signals.find((s) => s.severity !== 'info')?.text}</span>
            </li>
          ))}
          {device.counts.red + device.counts.amber > worst.length && (
            <li className="font-mono text-[11px] text-ink-400">and {device.counts.red + device.counts.amber - worst.length} more</li>
          )}
        </ul>
      )}

      <div className={`mt-auto font-mono text-[11px] ${device.stale ? LEVEL_TEXT.amber : 'text-ink-400'}`}>
        {device.lastReportAt === null ? 'no report' : device.stale ? `quiet for ${ago(device.lastReportAt)}` : `reported ${ago(device.lastReportAt)}${ago(device.lastReportAt) === 'just now' ? '' : ' ago'}`}
        {device.intervalMinutes !== null && <span className="text-ink-400"> · every {device.intervalMinutes}m</span>}
      </div>
    </Link>
  )
}
