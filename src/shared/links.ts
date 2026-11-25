// Recognises source URLs pasted by the user. Pure functions, shared by main and renderer.

export type ParsedLink =
  | { type: 'google'; url: string; family: string; slug: string }
  | { type: 'github'; url: string; owner: string; repo: string }
  | { type: 'adobe'; url: string; kitId: string }

/** google/fonts directory naming: lowercase, letters and digits only ("Noto Sans JP" → "notosansjp"). */
export function googleSlug(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function googleFromFamily(family: string): ParsedLink | null {
  const name = family.replace(/\+/g, ' ').trim()
  if (!name) return null
  return {
    type: 'google',
    url: `https://fonts.google.com/specimen/${name.replace(/ /g, '+')}`,
    family: name,
    slug: googleSlug(name)
  }
}

export function parseSourceLink(input: string): ParsedLink | { error: string } {
  let url: URL
  try {
    url = new URL(input.trim().replace(/^(?!https?:\/\/)/, 'https://'))
  } catch {
    return { error: 'That doesn’t look like a link.' }
  }
  const host = url.hostname.replace(/^www\./, '')

  if (host === 'fonts.google.com') {
    const m = url.pathname.match(/^\/specimen\/([^/]+)/)
    const parsed = m ? googleFromFamily(decodeURIComponent(m[1])) : null
    return parsed ?? { error: 'This Google Fonts link doesn’t name a family. Open the family’s specimen page and copy that link.' }
  }

  if (host === 'fonts.googleapis.com') {
    // css2: family=Inter:wght@400;700&family=Roboto ; css (v1): family=Inter:400,700|Roboto
    const raw = url.searchParams.getAll('family')[0]
    const first = raw?.split('|')[0]?.split(':')[0]
    const parsed = first ? googleFromFamily(first) : null
    return parsed ?? { error: 'This Google Fonts CSS link doesn’t include a family.' }
  }

  if (host === 'github.com') {
    const [owner, repo] = url.pathname.split('/').filter(Boolean)
    if (!owner || !repo) return { error: 'Paste a link to a GitHub repository (github.com/owner/repo).' }
    const name = repo.replace(/\.git$/, '')
    return { type: 'github', url: `https://github.com/${owner}/${name}`, owner, repo: name }
  }

  if (host === 'use.typekit.net') {
    const m = url.pathname.match(/^\/([a-z0-9]+)\.css$/i)
    if (!m) return { error: 'Paste the Adobe Fonts web project link, like https://use.typekit.net/abc1234.css' }
    const kitId = m[1].toLowerCase()
    return { type: 'adobe', url: `https://use.typekit.net/${kitId}.css`, kitId }
  }

  if (host === 'fonts.adobe.com') {
    return { error: 'Paste the web project’s CSS link (https://use.typekit.net/….css) from Adobe Fonts → Web Projects.' }
  }

  return { error: 'Only Google Fonts, GitHub and Adobe Fonts (use.typekit.net) links are supported.' }
}
