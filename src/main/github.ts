import { net } from 'electron'
import { basename, dirname, extname } from 'node:path'
import yauzl from 'yauzl'
import type { GitHubFile, GitHubImportResult, GitHubPreview } from '@shared/api'
import { parseSourceLink } from '@shared/links'
import { importInputs, type Input } from './importer'

// GitHub import: list the font files in a repo's latest release (including inside release
// zips) and on its default branch, then copy the files the user picks into the library.
// Unauthenticated API calls are limited to 60 an hour, so lookups are cached.

const API = 'https://api.github.com'
const FONT_EXTS = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'])
const MAX_ZIP_BYTES = 150 * 1024 * 1024
const MAX_FONT_BYTES = 100 * 1024 * 1024
const CACHE_MS = 10 * 60 * 1000

interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

interface Lookup {
  preview: GitHubPreview
  owner: string
  repo: string
  /** Download URL for each release asset, by name. */
  assetUrls: Map<string, string>
  /** Release zips already downloaded during lookup, by asset name. */
  zips: Map<string, Buffer>
  at: number
}

const cache = new Map<string, Lookup>()

function isFont(path: string): boolean {
  return FONT_EXTS.has(extname(path).toLowerCase())
}

function isHiddenPath(path: string): boolean {
  return path.split('/').some((p) => p.startsWith('.') || p === '__MACOSX')
}

async function api<T>(path: string): Promise<T | null> {
  const res = await net.fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'FontLib'
    }
  })
  if (res.status === 404) return null
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    const minutes = Math.max(1, Math.ceil((reset - Date.now()) / 60000))
    throw new Error(`GitHub’s hourly limit for anonymous requests is used up. Try again in about ${minutes} min.`)
  }
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
  return (await res.json()) as T
}

async function download(url: string, max: number): Promise<Buffer> {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'FontLib' } })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > max) throw new Error('File is too large')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > max) throw new Error('File is too large')
  return buf
}

/** Lists font entries in a zip, or reads the given entries' contents. */
function readZipBuffer(buf: Buffer, want?: Set<string>): Promise<Map<string, { size: number; data?: Buffer }>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Could not open zip'))
      const out = new Map<string, { size: number; data?: Buffer }>()
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName
        const ok = !name.endsWith('/') && !isHiddenPath(name) && isFont(name) && entry.uncompressedSize <= MAX_FONT_BYTES
        if (!ok) return zip.readEntry()
        if (!want) {
          out.set(name, { size: entry.uncompressedSize })
          return zip.readEntry()
        }
        if (!want.has(name)) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            out.set(name, { size: entry.uncompressedSize, data: Buffer.concat(chunks) })
            zip.readEntry()
          })
          stream.on('error', reject)
        })
      })
      zip.on('end', () => resolve(out))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

/** The folder part of a path, or '' at the root. */
function folderOf(path: string): string {
  const d = dirname(path)
  return d === '.' ? '' : d
}

export async function lookupGitHub(input: string): Promise<Lookup> {
  const link = parseSourceLink(input)
  if ('error' in link) throw new Error(link.error)
  if (link.type !== 'github') throw new Error('Not a GitHub link')
  const hit = cache.get(link.url)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit

  const { owner, repo } = link
  let info
  try {
    info = await api<{
      full_name: string
      html_url: string
      description: string | null
      default_branch: string
      license: { name: string; spdx_id: string } | null
    }>(`/repos/${owner}/${repo}`)
  } catch (e) {
    if ((e as Error).message.includes('limit')) throw e
    throw new Error(`Couldn’t reach GitHub (${(e as Error).message}). Are you online?`)
  }
  if (!info) throw new Error(`The repository ${owner}/${repo} wasn’t found (or it’s private).`)

  const [branch, release] = await Promise.all([
    api<{ commit: { sha: string } }>(`/repos/${owner}/${repo}/branches/${encodeURIComponent(info.default_branch)}`),
    api<{ tag_name: string; name: string | null; html_url: string; assets: ReleaseAsset[] }>(
      `/repos/${owner}/${repo}/releases/latest`
    )
  ])
  const commit = branch?.commit.sha ?? info.default_branch
  const tree = await api<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`
  )

  const branchFiles: GitHubFile[] = (tree?.tree ?? [])
    .filter((t) => t.type === 'blob' && isFont(t.path) && !isHiddenPath(t.path))
    .map((t) => ({ id: `tree:${t.path}`, path: t.path, name: basename(t.path), size: t.size ?? 0, group: folderOf(t.path) }))

  const licenseFile = (tree?.tree ?? []).find(
    (t) => t.type === 'blob' && !t.path.includes('/') && /^(license|licence|ofl|copying)(\.(md|txt))?$/i.test(t.path)
  )

  const assetUrls = new Map<string, string>()
  const zips = new Map<string, Buffer>()
  const releaseFiles: GitHubFile[] = []
  const skippedArchives: string[] = []
  for (const a of release?.assets ?? []) {
    assetUrls.set(a.name, a.browser_download_url)
    if (isFont(a.name)) {
      releaseFiles.push({ id: `rel:${a.name}`, path: a.name, name: a.name, size: a.size, group: '' })
    } else if (a.name.toLowerCase().endsWith('.zip')) {
      if (a.size > MAX_ZIP_BYTES) {
        skippedArchives.push(a.name)
        continue
      }
      try {
        const buf = await download(a.browser_download_url, MAX_ZIP_BYTES)
        zips.set(a.name, buf)
        for (const [entry, { size }] of await readZipBuffer(buf)) {
          releaseFiles.push({
            id: `zip:${a.name}:${entry}`,
            path: entry,
            name: basename(entry),
            size,
            group: [a.name, folderOf(entry)].filter(Boolean).join(' / ')
          })
        }
      } catch {
        skippedArchives.push(a.name)
      }
    }
  }

  const lookup: Lookup = {
    owner,
    repo,
    assetUrls,
    zips,
    at: Date.now(),
    preview: {
      url: link.url,
      owner,
      repo,
      description: info.description,
      license: info.license && info.license.spdx_id !== 'NOASSERTION' ? info.license.name : null,
      licenseUrl: licenseFile ? `${info.html_url}/blob/${commit}/${licenseFile.path}` : null,
      defaultBranch: info.default_branch,
      commit,
      release: release ? { tag: release.tag_name, name: release.name || release.tag_name, url: release.html_url } : null,
      releaseFiles,
      branchFiles,
      truncated: tree?.truncated ?? false,
      skippedArchives
    }
  }
  cache.set(link.url, lookup)
  return lookup
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

export async function importGitHub(input: string, fileIds: unknown): Promise<GitHubImportResult> {
  if (!Array.isArray(fileIds) || fileIds.length === 0 || !fileIds.every((f) => typeof f === 'string')) {
    throw new Error('Choose at least one file to import')
  }
  const lk = await lookupGitHub(input)
  const p = lk.preview
  const known = new Set([...p.releaseFiles, ...p.branchFiles].map((f) => f.id))
  const ids = (fileIds as string[]).filter((id) => known.has(id))

  const errors: GitHubImportResult['errors'] = []
  const inputs: Input[] = []

  // Release zips: read all wanted entries from each zip in one pass.
  const zipWants = new Map<string, Set<string>>()
  for (const id of ids.filter((i) => i.startsWith('zip:'))) {
    const rest = id.slice(4)
    const sep = rest.indexOf(':')
    const asset = rest.slice(0, sep)
    const entry = rest.slice(sep + 1)
    if (!zipWants.has(asset)) zipWants.set(asset, new Set())
    zipWants.get(asset)!.add(entry)
  }
  for (const [asset, entries] of zipWants) {
    try {
      const buf = lk.zips.get(asset) ?? (await download(lk.assetUrls.get(asset)!, MAX_ZIP_BYTES))
      for (const [entry, { data }] of await readZipBuffer(buf, entries)) {
        if (data) inputs.push({ origin: `${asset}/${entry}`, filename: basename(entry), buffer: data })
      }
    } catch (e) {
      errors.push({ file: asset, message: (e as Error).message })
    }
  }

  // Single files: release assets and branch files, a few at a time.
  const singles = ids.filter((i) => i.startsWith('rel:') || i.startsWith('tree:'))
  await mapLimit(singles, 4, async (id) => {
    const isRelease = id.startsWith('rel:')
    const path = isRelease ? id.slice(4) : id.slice(5)
    const url = isRelease
      ? lk.assetUrls.get(path)!
      : `https://raw.githubusercontent.com/${lk.owner}/${lk.repo}/${p.commit}/${path.split('/').map(encodeURIComponent).join('/')}`
    try {
      inputs.push({ origin: `${lk.owner}/${lk.repo}/${path}`, filename: basename(path), buffer: await download(url, MAX_FONT_BYTES) })
    } catch (e) {
      errors.push({ file: path, message: (e as Error).message })
    }
  })

  // Record the release tag if any file came from the release, else the commit.
  const fromRelease = ids.some((i) => i.startsWith('rel:') || i.startsWith('zip:'))
  const ref = fromRelease && p.release ? p.release.tag : p.commit.slice(0, 7)
  const outcome = importInputs(inputs, {
    type: 'github',
    url: p.url,
    ref,
    meta: {
      owner: lk.owner,
      repo: lk.repo,
      branch: p.defaultBranch,
      commit: p.commit,
      tag: fromRelease ? (p.release?.tag ?? null) : null
    },
    license: p.license,
    licenseUrl: p.licenseUrl
  })
  outcome.errors.unshift(...errors)
  return outcome
}
