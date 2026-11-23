import { useState } from 'react'
import type { DeviceView, FleetResponse, RepoView } from '../../shared/api.ts'
import { worst, type Level } from '../../shared/rules.ts'
import { Empty, Kicker, Lamp, Link, Panel } from './ui.tsx'

interface Copy {
  device: DeviceView
  repo: RepoView
}

interface Group {
  key: string
  name: string
  level: Level
  copies: Copy[]
}

const ORDER: Record<Level, number> = { red: 0, amber: 1, green: 2, quiet: 3, unknown: 4 }

/** The same repository, wherever it is cloned: which machines have it and which of them hold work. */
export function Repos({ fleet }: { fleet: FleetResponse }) {
  const [query, setQuery] = useState('')
  const [shared, setShared] = useState(false)

  const groups = new Map<string, Group>()
  for (const device of fleet.devices) {
    for (const repo of device.repos) {
      // Without a remote there is nothing to match on, so each stands alone.
      const key = repo.remoteKey ?? `${device.id}:${repo.path}`
      const group = groups.get(key) ?? { key, name: repo.remoteKey ?? repo.name, level: 'green', copies: [] }
      group.copies.push({ device, repo })
      groups.set(key, group)
    }
  }

  const rows = [...groups.values()]
    .map((g) => ({ ...g, level: g.copies.every((c) => c.repo.muted) ? ('quiet' as const) : worst(g.copies.map((c) => c.repo.level)) }))
    .filter((g) => (!shared || new Set(g.copies.map((c) => c.device.id)).size > 1) && (query === '' || g.name.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.name.localeCompare(b.name))

  return (
    <div className="flex flex-col gap-6 pt-8">
      <div className="flex flex-wrap items-center gap-3">
        <Kicker className="mr-2">Repos across the fleet</Kicker>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter repos"
          className="w-56 rounded-sm border border-ink-700 bg-ink-900 px-3 py-1.5 font-mono text-xs text-ink-100 placeholder:text-ink-400 focus:border-ink-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShared(!shared)}
          className={`rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${shared ? 'border-ink-300 text-ink-100' : 'border-ink-700 text-ink-400 hover:text-ink-200'}`}
        >
          On more than one device
        </button>
        <span className="font-mono text-[11px] text-ink-400">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <Empty>{groups.size === 0 ? 'No device has reported a repository yet.' : 'No repos match.'}</Empty>
      ) : (
        <Panel>
          {rows.map((group) => (
            <div key={group.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-800 px-4 py-2.5 last:border-b-0">
              <Lamp level={group.level} />
              <span className="min-w-0 flex-1 basis-64 truncate font-mono text-xs text-ink-100">{group.name}</span>
              <div className="flex flex-wrap gap-2">
                {group.copies.map(({ device, repo }) => (
                  <Link
                    key={`${device.id}:${repo.path}`}
                    to={{ page: 'device', id: device.id }}
                    title={repo.signals.map((s) => s.text).join('\n') || 'Everything is pushed'}
                    className="flex items-center gap-1.5 rounded-sm border border-ink-700 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-300 transition-colors hover:border-ink-400 hover:text-ink-100"
                  >
                    <Lamp level={repo.level} size="sm" />
                    {device.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}
