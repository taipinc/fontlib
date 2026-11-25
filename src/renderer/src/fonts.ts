import { useEffect, useState } from 'react'

// Loads a stored font face once per asset and registers it with document.fonts.
// Text using a face stays hidden until it has loaded, so a fallback font is never
// shown in place of the real one.

const cache = new Map<number, Promise<string>>()

export function faceName(assetId: number): string {
  return `fl-asset-${assetId}`
}

export function loadFace(assetId: number): Promise<string> {
  let p = cache.get(assetId)
  if (!p) {
    const name = faceName(assetId)
    const face = new FontFace(name, `url(fontlib://asset/${assetId})`)
    p = face.load().then((loaded) => {
      document.fonts.add(loaded)
      return name
    })
    p.catch(() => cache.delete(assetId))
    cache.set(assetId, p)
  }
  return p
}

export type FaceState = { status: 'loading' } | { status: 'ready'; family: string } | { status: 'error' }

export function useFace(assetId: number | null): FaceState {
  const [state, setState] = useState<FaceState>({ status: 'loading' })

  useEffect(() => {
    if (assetId === null) {
      setState({ status: 'error' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    loadFace(assetId).then(
      (family) => alive && setState({ status: 'ready', family }),
      () => alive && setState({ status: 'error' })
    )
    return () => {
      alive = false
    }
  }, [assetId])

  return state
}
