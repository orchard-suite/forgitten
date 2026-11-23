import { useQueryClient } from '@tanstack/react-query'
import { useFleet, useLiveUpdates } from './api.ts'
import { AddDevice } from './components/AddDevice.tsx'
import { Device } from './components/Device.tsx'
import { Fleet } from './components/Fleet.tsx'
import { Repos } from './components/Repos.tsx'
import { Empty, Link } from './components/ui.tsx'
import { ago } from './format.ts'
import { useRoute, type Route } from './router.ts'

export function App() {
  const client = useQueryClient()
  useLiveUpdates(client)
  const route = useRoute()
  const fleet = useFleet()

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-5 pb-16 md:px-8">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-ink-700 py-4">
        <Link to={{ page: 'fleet' }} className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="text-lg font-semibold tracking-tight">forgitten</span>
        </Link>
        <nav className="flex items-center">
          <Tab route={route} page="fleet" label="Fleet" />
          <Tab route={route} page="repos" label="Repos" />
          <Tab route={route} page="add" label="Add device" />
        </nav>
        {fleet.data && (
          <div className="ml-auto flex items-center gap-4 font-mono text-[11px] text-ink-400">
            <span title={`forgitten ${fleet.data.version}`}>updated {ago(fleet.data.generatedAt)}{ago(fleet.data.generatedAt) === 'just now' ? '' : ' ago'}</span>
            <span className="text-ink-300">{fleet.data.user}</span>
            {/* The login proxy owns this path; without one there is no session to end. */}
            {fleet.data.user !== 'local' && (
              <a href="/oauth2/sign_out" className="uppercase tracking-wide hover:text-ink-100">
                Sign out
              </a>
            )}
          </div>
        )}
      </header>
      <main className="flex-1">
        {fleet.isPending && <p className="py-16 text-center font-mono text-xs text-ink-400">Loading the fleet…</p>}
        {fleet.isError && (
          <div className="pt-8">
            <Empty>Could not load the fleet: {fleet.error.message}</Empty>
          </div>
        )}
        {fleet.data && route.page === 'fleet' && <Fleet fleet={fleet.data} />}
        {fleet.data && route.page === 'repos' && <Repos fleet={fleet.data} />}
        {fleet.data && route.page === 'add' && <AddDevice fleet={fleet.data} />}
        {fleet.data && route.page === 'device' && <Device fleet={fleet.data} id={route.id} />}
      </main>
    </div>
  )
}

function Tab({ route, page, label }: { route: Route; page: 'fleet' | 'repos' | 'add'; label: string }) {
  const active = route.page === page || (page === 'fleet' && route.page === 'device')
  return (
    <Link to={{ page }} className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${active ? 'text-ink-100' : 'text-ink-400 hover:text-ink-200'}`}>
      {label}
    </Link>
  )
}
