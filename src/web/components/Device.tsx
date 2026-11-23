import { useState } from 'react'
import type { DeviceView, FleetResponse } from '../../shared/api.ts'
import type { Level } from '../../shared/rules.ts'
import { useRemoveDevice, useRenameDevice } from '../api.ts'
import { ago, date } from '../format.ts'
import { navigate } from '../router.ts'
import { RepoRow } from './RepoRow.tsx'
import { Button, Empty, Kicker, LEVEL_LABEL, Lamp, Link, Panel } from './ui.tsx'

const LEVELS: Level[] = ['red', 'amber', 'green', 'quiet']
const ORDER: Record<Level, number> = { red: 0, amber: 1, green: 2, quiet: 3, unknown: 4 }

export function Device({ fleet, id }: { fleet: FleetResponse; id: string }) {
  const device = fleet.devices.find((d) => d.id === id)
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState<Level | null>(null)

  if (!device) {
    return (
      <div className="pt-8">
        <Empty>
          This device is not in the fleet.{' '}
          <Link to={{ page: 'fleet' }} className="text-ink-100 underline underline-offset-4">
            Back to the fleet
          </Link>
        </Empty>
      </div>
    )
  }

  const repos = device.repos
    .filter((r) => (only === null || r.level === only) && (query === '' || `${r.name} ${r.path}`.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.name.localeCompare(b.name))

  return (
    <div className="flex flex-col gap-8 pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Lamp level={device.level} size="lg" />
          <Name device={device} />
        </div>
        <Remove device={device} />
      </div>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-ink-700 py-5 md:grid-cols-4">
        <Fact label="Last report" warn={device.stale}>
          {device.lastReportAt === null ? 'never' : `${ago(device.lastReportAt)}${ago(device.lastReportAt) === 'just now' ? '' : ' ago'}`}
          {device.stale && device.staleAfterMinutes !== null && <span className="block text-[10px]">expected within {device.staleAfterMinutes}m</span>}
        </Fact>
        <Fact label="Schedule">{device.intervalMinutes === null ? 'none installed' : `every ${device.intervalMinutes}m`}</Fact>
        <Fact label="Machine">
          {device.hostname}
          <span className="block text-[10px] text-ink-400">{device.platform} · {device.arch}</span>
        </Fact>
        <Fact label="Signed in by">
          {device.registeredBy}
          <span className="block text-[10px] text-ink-400">{date(device.createdAt)} · cli v{device.version}</span>
        </Fact>
        <Fact label="Scans" wide>
          {device.roots.length === 0 ? 'nothing yet' : device.roots.join('  ·  ')}
          {device.scanDurationMs !== null && <span className="text-ink-400"> · took {(device.scanDurationMs / 1000).toFixed(1)}s</span>}
        </Fact>
        {device.ignore.length > 0 && (
          <Fact label="Ignores" wide>
            {device.ignore.join('  ·  ')}
          </Fact>
        )}
      </dl>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Kicker className="mr-2">Repos</Kicker>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter repos"
            className="w-56 rounded-sm border border-ink-700 bg-ink-900 px-3 py-1.5 font-mono text-xs text-ink-100 placeholder:text-ink-400 focus:border-ink-400 focus:outline-none"
          />
          <div className="flex gap-1">
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                title={LEVEL_LABEL[level]}
                onClick={() => setOnly(only === level ? null : level)}
                className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                  only === level ? 'border-ink-300 text-ink-100' : 'border-ink-700 text-ink-400 hover:text-ink-200'
                }`}
              >
                <Lamp level={level} size="sm" /> {device.counts[level as keyof typeof device.counts]}
              </button>
            ))}
          </div>
        </div>
        {device.lastReportAt === null ? (
          <Empty>This device joined but has not reported yet. Run `forgitten fleet report` on it.</Empty>
        ) : repos.length === 0 ? (
          <Empty>{device.repos.length === 0 ? 'The last scan found no git repositories under the directories above.' : 'No repos match.'}</Empty>
        ) : (
          <Panel>
            {repos.map((repo) => (
              <RepoRow key={repo.path} deviceId={device.id} repo={repo} />
            ))}
          </Panel>
        )}
      </div>
    </div>
  )
}

/** The device name, renamed where it is shown: click it, type, Enter. */
function Name({ device }: { device: DeviceView }) {
  const rename = useRenameDevice(device.id)
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <button type="button" onClick={() => setDraft(device.name)} title="Click to rename" className="text-left text-3xl font-semibold tracking-tight decoration-ink-600 underline-offset-8 hover:underline md:text-4xl">
        {device.name}
      </button>
    )
  }

  const save = () => {
    const name = draft.trim()
    if (name && name !== device.name) rename.mutate(name)
    setDraft(null)
  }
  return (
    <input
      autoFocus
      value={draft}
      maxLength={100}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') setDraft(null)
      }}
      className="w-[min(32rem,70vw)] border-b border-ink-400 bg-transparent text-3xl font-semibold tracking-tight focus:outline-none md:text-4xl"
    />
  )
}

function Remove({ device }: { device: DeviceView }) {
  const remove = useRemoveDevice(device.id)
  const [asking, setAsking] = useState(false)

  if (!asking) return <Button onClick={() => setAsking(true)}>Remove device</Button>
  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <p className="text-right text-xs text-ink-300">
        Its report is deleted and its next ones are refused. To stop it trying, run <code className="font-mono text-ink-100">forgitten fleet leave</code> on the device.
      </p>
      <div className="flex gap-2">
        <Button kind="danger" disabled={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: () => navigate({ page: 'fleet' }) })}>
          Remove {device.name}
        </Button>
        <Button onClick={() => setAsking(false)}>Keep</Button>
      </div>
      {remove.isError && <span className="text-xs text-red">{remove.error.message}</span>}
    </div>
  )
}

function Fact({ label, children, warn, wide }: { label: string; children: React.ReactNode; warn?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 md:col-span-4' : ''}>
      <dt>
        <Kicker>{label}</Kicker>
      </dt>
      <dd className={`mt-1 font-mono text-xs break-all ${warn ? 'text-amber' : 'text-ink-100'}`}>{children}</dd>
    </div>
  )
}
