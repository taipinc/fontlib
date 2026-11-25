// Google Fonts helpers shared by main and renderer (pure functions).

export interface GoogleAxis {
  tag: string
  min: number
  max: number
}

export interface GoogleStyleRef {
  weight: number
  italic: boolean
}

/** Data kept on a Google source: enough to rebuild the CSS2 URL without refetching metadata. */
export interface GoogleMeta {
  family: string
  slug: string
  /** Path of the family folder in the google/fonts repo, e.g. "ofl/inter". */
  repoPath: string
  axes: GoogleAxis[]
  styles: GoogleStyleRef[]
  cssUrl: string
}

/** Google sorts axis tags alphabetically, lowercase (registered) tags first. */
function sortTags(tags: string[]): string[] {
  const lower = tags.filter((t) => t === t.toLowerCase()).sort()
  const upper = tags.filter((t) => t !== t.toLowerCase()).sort()
  return [...lower, ...upper]
}

/** Builds a css2 URL that loads every style (and the full axis ranges) of a family. */
export function buildCss2Url(family: string, axes: GoogleAxis[], styles: GoogleStyleRef[]): string {
  const name = encodeURIComponent(family).replace(/%20/g, '+')
  const hasItalic = styles.some((s) => s.italic)
  const variableAxes = axes.filter((a) => a.tag !== 'ital')

  let spec: string
  if (variableAxes.length) {
    const tags = sortTags(variableAxes.map((a) => a.tag))
    const range = (tag: string): string => {
      const a = variableAxes.find((x) => x.tag === tag)!
      return a.min === a.max ? `${a.min}` : `${a.min}..${a.max}`
    }
    const values = tags.map(range).join(',')
    if (hasItalic) {
      spec = `ital,${tags.join(',')}@0,${values};1,${values}`
    } else {
      spec = `${tags.join(',')}@${values}`
    }
  } else {
    const tuples = [...new Map(styles.map((s) => [`${s.italic ? 1 : 0},${s.weight}`, s])).values()].sort((a, b) =>
      a.italic === b.italic ? a.weight - b.weight : a.italic ? 1 : -1
    )
    spec = hasItalic
      ? `ital,wght@${tuples.map((s) => `${s.italic ? 1 : 0},${s.weight}`).join(';')}`
      : `wght@${tuples.map((s) => s.weight).join(';')}`
  }
  return `https://fonts.googleapis.com/css2?family=${name}:${spec}&display=block`
}

export const GOOGLE_CATEGORY: Record<string, string> = {
  SANS_SERIF: 'Sans Serif',
  SERIF: 'Serif',
  DISPLAY: 'Display',
  HANDWRITING: 'Handwriting',
  MONOSPACE: 'Monospace'
}

export const GOOGLE_LICENSE: Record<string, { name: string; url: string }> = {
  OFL: { name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org' },
  APACHE2: { name: 'Apache License 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  UFL: { name: 'Ubuntu Font Licence 1.0', url: 'https://ubuntu.com/legal/font-licence' }
}
