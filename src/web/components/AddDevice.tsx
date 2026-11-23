import type { ReactNode } from 'react'
import type { FleetResponse } from '../../shared/api.ts'
import { ago } from '../format.ts'
import { Command, Empty, Kicker, Lamp, Link, Panel } from './ui.tsx'

export function AddDevice({ fleet }: { fleet: FleetResponse }) {
  const { setup, devices } = fleet
  const newest = [...devices].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="grid gap-10 pt-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-8">
        <h1 className="max-w-2xl text-4xl leading-[1.05] font-semibold tracking-tight md:text-5xl">Add a device to the fleet.</h1>

        {!setup.configured && (
          <Empty>This hub has no Entra app configured, so devices cannot sign in yet. Set ENTRA_TENANT_ID and ENTRA_CLIENT_ID on the hub.</Empty>
        )}

        <Step n={1} title="Install the CLI on that machine">
          <Command>{setup.installCommand}</Command>
          <p className="text-sm text-ink-400">It needs git on the path. Nothing else.</p>
        </Step>

        <Step n={2} title="Join, and say which directories to scan">
          <Command>{setup.joinCommand}</Command>
          <p className="text-sm text-ink-400">
            It prints a code. Enter it at the Microsoft sign-in page, on any device, with your own account. Repeat <code className="font-mono text-ink-200">--path</code> for more
            directories, and add <code className="font-mono text-ink-200">--name</code> to call the device something other than its host name. The first report is sent at once.
          </p>
          <p className="text-sm text-ink-400">
            From then on the operating system runs the report every 15 minutes: a launchd daemon on macOS (it asks for your password once), a systemd user timer on Linux, Task Scheduler on Windows. Use{' '}
            <code className="font-mono text-ink-200">--interval</code> to change it, or <code className="font-mono text-ink-200">--no-agent</code> to report only by hand.
          </p>
        </Step>
      </div>

      <div className="flex flex-col gap-3">
        <Kicker>In the fleet</Kicker>
        {newest.length === 0 ? (
          <Empty>Waiting for the first device. It appears here the moment it joins.</Empty>
        ) : (
          <Panel>
            {newest.map((device) => (
              <Link key={device.id} to={{ page: 'device', id: device.id }} className="flex items-center gap-3 border-b border-ink-800 px-4 py-3 transition-colors last:border-b-0 hover:bg-ink-850">
                <Lamp level={device.level} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{device.name}</span>
                <span className="font-mono text-[11px] text-ink-400">joined {ago(device.createdAt)}{ago(device.createdAt) === 'just now' ? '' : ' ago'}</span>
              </Link>
            ))}
          </Panel>
        )}
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[2.5rem_1fr] gap-x-2">
      <div className="font-mono text-2xl text-ink-600">{n}</div>
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {children}
      </div>
    </section>
  )
}
