// OpenType features worth offering as toggles, with readable names. Features that are
// structural (mark positioning, Arabic joining forms, localisation…) are left out.

const NAMES: Record<string, string> = {
  kern: 'Kerning',
  liga: 'Standard ligatures',
  clig: 'Contextual ligatures',
  calt: 'Contextual alternates',
  dlig: 'Discretionary ligatures',
  hlig: 'Historical ligatures',
  salt: 'Stylistic alternates',
  swsh: 'Swash',
  cswh: 'Contextual swash',
  titl: 'Titling',
  smcp: 'Small caps',
  c2sc: 'Caps to small caps',
  pcap: 'Petite caps',
  c2pc: 'Caps to petite caps',
  unic: 'Unicase',
  case: 'Case-sensitive forms',
  cpsp: 'Capital spacing',
  lnum: 'Lining figures',
  onum: 'Oldstyle figures',
  pnum: 'Proportional figures',
  tnum: 'Tabular figures',
  zero: 'Slashed zero',
  frac: 'Fractions',
  afrc: 'Alternative fractions',
  sups: 'Superscript',
  subs: 'Subscript',
  sinf: 'Scientific inferiors',
  ordn: 'Ordinals',
  numr: 'Numerators',
  dnom: 'Denominators',
  hist: 'Historical forms',
  ornm: 'Ornaments',
  nalt: 'Alternate annotation',
  ital: 'Italics',
  ss01: 'Stylistic set 1'
}

/** Features browsers apply unless told otherwise. */
export const DEFAULT_ON = new Set(['kern', 'liga', 'clig', 'calt'])

export function featureName(tag: string): string | null {
  if (NAMES[tag]) return NAMES[tag]
  const ss = tag.match(/^ss(\d\d)$/)
  if (ss) return `Stylistic set ${Number(ss[1])}`
  const cv = tag.match(/^cv(\d\d)$/)
  if (cv) return `Character variant ${Number(cv[1])}`
  return null
}

/** The user-facing features of a style, in a stable, sensible order. */
export function userFeatures(tags: string[]): string[] {
  const order = Object.keys(NAMES)
  return tags
    .filter((t) => featureName(t) !== null)
    .sort((a, b) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
      return a.localeCompare(b)
    })
}

/** CSS font-feature-settings for the toggles that differ from the browser default. */
export function featureSettings(state: Record<string, boolean>): string | undefined {
  const parts = Object.entries(state)
    .filter(([tag, on]) => on !== DEFAULT_ON.has(tag))
    .map(([tag, on]) => `"${tag}" ${on ? 1 : 0}`)
  return parts.length ? parts.join(', ') : undefined
}
