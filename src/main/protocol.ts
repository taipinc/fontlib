import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { getDb } from './db'
import { fontsPath } from './paths'
import { extractFromCollection } from './sfnt'
import { scannedFace } from './system'

// fontlib://asset/<id> serves one font face by asset id. The renderer never sees file
// paths and can only reach files that are registered in the database.
// fontlib://system/<id> serves a face from the current installed-fonts scan (picker previews).

export const SCHEME = 'fontlib'

/** Must run before app 'ready'. */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

const MIME: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttc: 'font/ttf'
}

const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: HEADERS })
}

export function handleProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const id = Number(url.pathname.replace(/^\//, ''))
    if (!Number.isInteger(id)) return notFound()

    if (url.host === 'system') {
      const face = scannedFace(id)
      if (!face) return notFound()
      try {
        let data: Buffer = await readFile(face.path)
        if (face.index !== null) data = extractFromCollection(data, face.index)
        return new Response(new Uint8Array(data), { headers: { ...HEADERS, 'Content-Type': 'font/ttf' } })
      } catch {
        return notFound()
      }
    }
    if (url.host !== 'asset') return notFound()

    const asset = getDb()
      .prepare('SELECT kind, storage, path, collection_index FROM assets WHERE id = ?')
      .get(id) as { kind: string; storage: string; path: string; collection_index: number | null } | undefined
    if (!asset || asset.storage === 'remote') return notFound()

    let file: string
    if (asset.storage === 'stored') {
      const root = fontsPath()
      file = resolve(root, asset.path)
      if (!file.startsWith(root + sep)) return notFound()
    } else {
      if (!isAbsolute(asset.path)) return notFound()
      file = join(asset.path)
    }

    try {
      let data: Buffer = await readFile(file)
      let mime = MIME[asset.kind] ?? 'application/octet-stream'
      if (asset.collection_index !== null) {
        data = extractFromCollection(data, asset.collection_index)
        mime = 'font/ttf'
      }
      return new Response(new Uint8Array(data), { headers: { ...HEADERS, 'Content-Type': mime } })
    } catch {
      return notFound()
    }
  })
}
