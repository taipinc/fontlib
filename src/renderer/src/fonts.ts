import { useEffect, useState } from 'react'
import type { RemoteFace, StyleSummary } from '@shared/api'

// Loads font faces for previews. Text using a face stays hidden until it has loaded, so a
// fallback font is never shown in place of the real one.
//
// - Stored/system files: a FontFace per asset, served by the fontlib:// protocol.
// - Google Fonts: the family's CSS2 stylesheet is linked once, then document.fonts.load()
//   waits for the specific weight/style. If that fails, the face is reported offline.

const localCache = new Map<number, Promise<string>>()
const sheetCache = new Map<string, Promise<void>>()
const remoteCache = new Map<string, Promise<void>>()

export function faceName(assetId: number): string {
  return `fl-asset-${assetId}`
}

export function loadFace(assetId: number): Promise<string> {
  let p = localCache.get(assetId)
  if (!p) {
    const name = faceName(assetId)
    const face = new FontFace(name, `url(fontlib://asset/${assetId})`)
    p = face.load().then((loaded) => {
      document.fonts.add(loaded)
      return name
    })
    p.catch(() => localCache.delete(assetId))
    localCache.set(assetId, p)
  }
  return p
}

function loadStylesheet(href: string): Promise<void> {
  let p = sheetCache.get(href)
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      link.onload = () => resolve()
      link.onerror = () => {
        link.remove()
        reject(new Error('Stylesheet failed to load'))
      }
      document.head.appendChild(link)
    })
    p.catch(() => sheetCache.delete(href))
    sheetCache.set(href, p)
  }
  return p
}

export function loadRemoteFace(r: RemoteFace): Promise<void> {
  const key = `${r.cssUrl}|${r.weight}|${r.italic}`
  let p = remoteCache.get(key)
  if (!p) {
    p = loadStylesheet(r.cssUrl)
      .then(() => document.fonts.load(`${r.italic ? 'italic ' : ''}${r.weight} 32px "${r.family}"`, 'Aa'))
      .then((faces) => {
        if (faces.length === 0) throw new Error('Face did not load')
      })
    p.catch(() => remoteCache.delete(key))
    remoteCache.set(key, p)
  }
  return p
}

export type FaceState =
  | { status: 'loading' }
  | { status: 'ready'; family: string; weight?: number; italic?: boolean }
  | { status: 'offline' }
  | { status: 'error' }

export function useFace(style: StyleSummary | undefined): FaceState {
  const [state, setState] = useState<FaceState>({ status: 'loading' })
  const assetId = style?.assetId ?? null
  const remote = style?.remote
  const remoteKey = remote ? `${remote.cssUrl}|${remote.weight}|${remote.italic}` : null

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    if (assetId !== null) {
      loadFace(assetId).then(
        (family) => alive && setState({ status: 'ready', family }),
        () => alive && setState({ status: 'error' })
      )
    } else if (remote) {
      loadRemoteFace(remote).then(
        () => alive && setState({ status: 'ready', family: remote.family, weight: remote.weight, italic: remote.italic }),
        () => alive && setState({ status: navigator.onLine ? 'error' : 'offline' })
      )
    } else {
      setState({ status: 'error' })
    }
    // Retry web faces when the connection comes back.
    const onOnline = (): void => {
      if (remote && alive) {
        loadRemoteFace(remote).then(
          () => alive && setState({ status: 'ready', family: remote.family, weight: remote.weight, italic: remote.italic }),
          () => undefined
        )
      }
    }
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      window.removeEventListener('online', onOnline)
    }
  }, [assetId, remoteKey])

  return state
}

/** CSS font-variation-settings from axis values. */
export function variationCss(values: Record<string, number> | null | undefined): string | undefined {
  if (!values) return undefined
  const parts = Object.entries(values).map(([tag, v]) => `"${tag}" ${v}`)
  return parts.length ? parts.join(', ') : undefined
}
