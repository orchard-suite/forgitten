import type { ReactNode } from 'react'
import type { RepoView } from '../../shared/api.ts'
import { useMuteRepo } from '../api.ts'
import { Button, Lamp } from './ui.tsx'

/** One repository on one device: a line that opens into everything the device said about it. */
export function RepoRow({ deviceId, repo, lead }: { deviceId: string; repo: RepoView; lead?: ReactNode }) {
  const mute = useMuteRepo(deviceId)
  const headline = summarize(repo)
  const noteworthy = repo.branches.filter((b) => b.unpushed > 0 || b.ahead > 0 || b.behind > 0 || b.upstreamGone)
  const settled = repo.branches.length - noteworthy.length

  return (
    <details className="group border-b border-ink-800 last:border-b-0">
      <summary className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-850">
        <Lamp level={repo.level} />
        {lead}
        <span className="min-w-0 max-w-[50%] truncate font-mono text-xs text-ink-100">{repo.name}</span>
        <span className={`min-w-0 flex-1 truncate text-sm ${repo.muted ? 'text-ink-400 line-through decoration-ink-600' : 'text-ink-300'}`}>{headline || 'Everything is pushed'}</span>
        <span className="font-mono text-[10px] text-ink-400 group-open:hidden">open</span>
        <span className="hidden font-mono text-[10px] text-ink-400 group-open:inline">close</span>
      </summary>

      <div className="grid gap-4 px-4 pt-1 pb-5 pl-[2.375rem]">
        {repo.signals.length > 0 && (
          <ul className="grid gap-1.5">
            {repo.signals.map((signal) => (
              <li key={`${signal.kind}:${signal.text}`} className="flex items-baseline gap-2.5 text-sm text-ink-200">
                <Lamp level={signal.severity} size="sm" className="translate-y-[-1px]" />
                {signal.text}
              </li>
            ))}
          </ul>
        )}

        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
          <dt className="text-ink-400">Path</dt>
          <dd className="break-all text-ink-200">{repo.path}</dd>
          <dt className="text-ink-400">Remote</dt>
          <dd className="break-all text-ink-200">{repo.remoteUrl ?? 'none'}</dd>
          {repo.worktrees.map((w) => (
            <Checkout key={w.path} label={w.main ? 'Checkout' : 'Worktree'}>
              <span className="text-ink-100">{w.branch ?? `detached ${w.head}`}</span>
              {!w.main && <span className="text-ink-400"> at {w.path}</span>}
              <span className="text-ink-400"> · </span>
              {w.staged + w.modified + w.untracked + w.conflicted === 0
                ? 'clean'
                : [
                    w.conflicted && `${w.conflicted} conflicted`,
                    w.staged && `${w.staged} staged`,
                    w.modified && `${w.modified} modified`,
                    w.untracked && `${w.untracked} untracked`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
            </Checkout>
          ))}
          {noteworthy.map((b) => (
            <Checkout key={b.name} label="Branch">
              <span className="text-ink-100">{b.name}</span>
              <span className="text-ink-400"> · </span>
              {[
                b.unpushed > 0 && `${b.unpushed} unpushed`,
                b.upstream === null && 'no upstream',
                b.upstreamGone && `${b.upstream} was deleted`,
                !b.upstreamGone && b.ahead > 0 && `${b.ahead} ahead of ${b.upstream}`,
                !b.upstreamGone && b.behind > 0 && `${b.behind} behind ${b.upstream}`,
              ]
                .filter(Boolean)
                .join(', ')}
            </Checkout>
          ))}
          {settled > 0 && (
            <Checkout label={noteworthy.length > 0 ? '' : 'Branches'}>
              <span className="text-ink-400">
                {noteworthy.length > 0 ? `and ${settled} more in sync` : `${settled} in sync`}
              </span>
            </Checkout>
          )}
        </dl>

        <div className="flex items-center gap-3">
          <Button onClick={() => mute.mutate({ path: repo.path, muted: !repo.muted })} disabled={mute.isPending}>
            {repo.muted ? 'Unmute' : 'Mute on this device'}
          </Button>
          <span className="text-xs text-ink-400">{repo.muted ? 'Muted: it no longer colours this device.' : 'A muted repo stays listed but no longer colours the device.'}</span>
          {mute.isError && <span className="text-xs text-red">{mute.error.message}</span>}
        </div>
      </div>
    </details>
  )
}

/** The line shown while the row is closed. Many branches with the same trouble are said once. */
function summarize(repo: RepoView): string {
  const loud = repo.signals.filter((s) => s.severity !== 'info')
  const unpushed = loud.filter((s) => s.kind === 'unpushed')
  if (unpushed.length <= 2) return (loud.length > 0 ? loud : repo.signals).map((s) => s.text).join(' · ')

  const commits = repo.branches.reduce((n, b) => n + b.unpushed, 0)
  const rest = loud.filter((s) => s.kind !== 'unpushed').map((s) => s.text)
  return [...rest, `${commits.toLocaleString()} commits across ${unpushed.length} branches are on no remote`].join(' · ')
}

function Checkout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-400">{label}</dt>
      <dd className="break-all text-ink-300">{children}</dd>
    </>
  )
}
