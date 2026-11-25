import type { FamilyDetail, RoleSettings, StyleDetail } from '@shared/api'

// Builds the CSS for a heading/body pairing: embed links for Google and Adobe families,
// @font-face blocks (relative paths) for stored files, local() for system fonts, and the
// font-family rules with each role's settings.

export interface RoleInput {
  family: FamilyDetail
  style: StyleDetail
  settings: RoleSettings
}

const FORMAT: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype', ttc: 'collection' }
const PREFERENCE = ['woff2', 'woff', 'ttf', 'otf']

function generic(category: string | null): string {
  const c = (category ?? '').toLowerCase()
  if (c.includes('mono')) return 'monospace'
  if (c.includes('serif') && !c.includes('sans')) return 'serif'
  if (c.includes('script') || c.includes('hand')) return 'cursive'
  return 'sans-serif'
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

interface Resolved {
  cssFamily: string
  embed: { html: string; css: string } | null
  fontFace: string | null
  note: string | null
}

function resolve(r: RoleInput): Resolved {
  const { family, style } = r
  const stored = style.assets
    .filter((a) => a.storage === 'stored' && !a.missing)
    .sort((a, b) => PREFERENCE.indexOf(a.kind) - PREFERENCE.indexOf(b.kind))
  const system = style.assets.find((a) => a.storage === 'system-path' && !a.missing)
  const remote = style.assets.find((a) => a.storage === 'remote' && !a.missing)
  const source = remote ? family.sources.find((s) => s.type === remote.sourceType) : undefined
  const wght = style.axes.find((a) => a.tag === 'wght')
  const weight = wght ? `${wght.min} ${wght.max}` : String(style.weight)
  const faceStyle = style.italic ? 'italic' : 'normal'

  if (stored.length) {
    const src = stored
      .filter((a) => a.kind !== 'ttc')
      .map((a) => `url("fonts/${basename(a.path)}") format("${FORMAT[a.kind] ?? a.kind}")`)
      .join(',\n       ')
    return {
      cssFamily: family.name,
      embed: null,
      fontFace: `@font-face {
  font-family: "${family.name}";
  src: ${src};
  font-weight: ${weight};
  font-style: ${faceStyle};
  font-display: swap;
}`,
      note: `Copy ${stored.map((a) => basename(a.path)).join(', ')} into a fonts/ folder next to this CSS.`
    }
  }
  if (remote && source?.type === 'google') {
    const cssUrl = remote.path.replace('display=block', 'display=swap')
    return {
      cssFamily: source.cssName ?? family.name,
      embed: {
        html: `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${cssUrl}">`,
        css: `@import url("${cssUrl}");`
      },
      fontFace: null,
      note: null
    }
  }
  if (remote && source?.type === 'adobe') {
    return {
      cssFamily: source.cssName ?? family.name,
      embed: { html: `<link rel="stylesheet" href="${remote.path}">`, css: `@import url("${remote.path}");` },
      fontFace: null,
      note: 'Adobe Fonts: the kit only serves the domains allowed in its web project settings.'
    }
  }
  if (system) {
    return {
      cssFamily: family.name,
      embed: null,
      fontFace: `@font-face {
  font-family: "${family.name}";
  src: local("${style.postscriptName}");
  font-weight: ${weight};
  font-style: ${faceStyle};
}`,
      note: `${family.name} is a system font: it only renders where it is installed, and is often not licensed for web use.`
    }
  }
  return { cssFamily: family.name, embed: null, fontFace: null, note: `${family.name}: no usable files.` }
}

function rule(selector: string, r: RoleInput, res: Resolved, withSize: boolean): string {
  const s = r.settings
  const lines = [
    `  font-family: "${res.cssFamily}", ${generic(r.family.category)};`,
    `  font-weight: ${r.style.weight};`,
    r.style.italic ? '  font-style: italic;' : null,
    withSize ? `  font-size: ${s.size}px;` : null,
    `  line-height: ${s.lineHeight};`,
    s.tracking ? `  letter-spacing: ${s.tracking}em;` : null,
    s.variation && Object.keys(s.variation).length
      ? `  font-variation-settings: ${Object.entries(s.variation).map(([t, v]) => `"${t}" ${v}`).join(', ')};`
      : null
  ].filter(Boolean)
  return `${selector} {\n${lines.join('\n')}\n}`
}

export function pairingCss(heading: RoleInput, body: RoleInput, name?: string): string {
  const h = resolve(heading)
  const b = resolve(body)
  const parts: string[] = [`/* ${name ? `${name}: ` : ''}${heading.family.name} + ${body.family.name} (FontLib) */`]

  const embeds = [h.embed, b.embed].filter((e): e is NonNullable<Resolved['embed']> => !!e)
  const uniqueEmbeds = [...new Map(embeds.map((e) => [e.css, e])).values()]
  if (uniqueEmbeds.length) {
    parts.push(`/* In the HTML <head>:\n${uniqueEmbeds.map((e) => e.html).join('\n')}\n   or in CSS: */`)
    parts.push(uniqueEmbeds.map((e) => e.css).join('\n'))
  }
  const faces = [...new Set([h.fontFace, b.fontFace].filter(Boolean))]
  if (faces.length) parts.push(faces.join('\n\n'))
  parts.push(rule('body', body, b, true))
  parts.push(rule('h1, h2, h3', heading, h, false))
  parts.push(`h1 { font-size: ${heading.settings.size}px; }\nh2 { font-size: ${Math.round(heading.settings.size * 0.6)}px; }`)
  const notes = [...new Set([h.note, b.note].filter(Boolean))]
  if (notes.length) parts.push(notes.map((n) => `/* ${n} */`).join('\n'))
  return parts.join('\n\n') + '\n'
}
