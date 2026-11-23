import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { FleetResponse } from '../shared/api.ts'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

const FLEET = ['fleet'] as const

/** The whole board. Refetched each minute so a device that went quiet turns stale without a reload. */
export function useFleet() {
  return useQuery({ queryKey: FLEET, queryFn: () => call<FleetResponse>('/api/fleet'), staleTime: 10_000, refetchInterval: 60_000 })
}

function useFleetMutation<T>(run: (input: T) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation({ mutationFn: run, onSuccess: () => client.invalidateQueries({ queryKey: FLEET }) })
}

const device = (id: string) => `/api/devices/${encodeURIComponent(id)}`

export function useRenameDevice(id: string) {
  return useFleetMutation((name: string) => call(device(id), { method: 'PATCH', body: JSON.stringify({ name }) }))
}

export function useRemoveDevice(id: string) {
  return useFleetMutation(() => call(device(id), { method: 'DELETE' }))
}

export function useMuteRepo(id: string) {
  return useFleetMutation((input: { path: string; muted: boolean }) => call(`${device(id)}/muted`, { method: 'PUT', body: JSON.stringify(input) }))
}

/** Refetches the board when the server says a device reported or something was changed. */
export function useLiveUpdates(client: QueryClient): void {
  useEffect(() => {
    const source = new EventSource('/api/events')
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void client.invalidateQueries({ queryKey: FLEET }), 300)
    }
    source.addEventListener('fleet', refresh)
    return () => {
      if (timer) clearTimeout(timer)
      source.close()
    }
  }, [client])
}
