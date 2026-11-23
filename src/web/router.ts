import { useEffect, useState } from 'react'

export type Route = { page: 'fleet' } | { page: 'repos' } | { page: 'add' } | { page: 'device'; id: string }

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'repos') return { page: 'repos' }
  if (parts[0] === 'add') return { page: 'add' }
  if (parts[0] === 'devices' && parts[1]) return { page: 'device', id: decodeURIComponent(parts[1]) }
  return { page: 'fleet' }
}

export function href(route: Route): string {
  switch (route.page) {
    case 'fleet':
      return '/'
    case 'repos':
      return '/repos'
    case 'add':
      return '/add'
    case 'device':
      return `/devices/${encodeURIComponent(route.id)}`
  }
}

export function navigate(route: Route): void {
  history.pushState(null, '', href(route))
  dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.pathname))
    addEventListener('popstate', onChange)
    return () => removeEventListener('popstate', onChange)
  }, [])
  return route
}

/** Lets plain anchors use the in-app router. */
export function onLinkClick(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  navigate(parseRoute(new URL(event.currentTarget.href).pathname))
}
