import { useEffect, useMemo, useState } from 'react'
import type { GlyphInfo, StyleSummary } from '@shared/api'
import { useFace } from '../fonts'
import { blockOf, displayChar, hex } from '../unicode'

const PAGE = 1200

interface Props {
  style: StyleSummary
  variation?: string
  features?: string
}

/** Every encoded character of a style, drawn in that style; hover to inspect, click to copy. */
export function GlyphMap({ style, variation, features }: Props) {
  const [info, setInfo] = useState<GlyphInfo | null | undefined>(undefined)
  const [block, setBlock] = useState('All')
  const [limit, setLimit] = useState(PAGE)
  const [focus, setFocus] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const face = useFace(style)

  useEffect(() => {
    let alive = true
    setInfo(undefined)
    setLimit(PAGE)
    window.fontlib.library.glyphs(style.id).then(
      (g) => alive && setInfo(g),
      () => alive && setInfo(null)
    )
    return () => {
      alive = false
    }
  }, [style.id])

  const blocks = useMemo(() => {
    const counts = new Map<string, number>()
    for (const cp of info?.codePoints ?? []) counts.set(blockOf(cp), (counts.get(blockOf(cp)) ?? 0) + 1)
    return [...counts]
  }, [info])

  const indexes = useMemo(() => {
    const cps = info?.codePoints ?? []
    const out: number[] = []
    cps.forEach((cp, i) => (block === 'All' || blockOf(cp) === block) && out.push(i))
    return out
  }, [info, block])

  if (info === undefined) return <div className="glyph-note">Reading the character map…</div>
  if (info === null) {
    return (
      <div className="glyph-note">
        The glyph map needs a font file. {style.remote ? 'Google Fonts families are stored as links only.' : ''}
      </div>
    )
  }

  const fontCss = {
    fontFamily: face.status === 'ready' ? `"${face.family}"` : undefined,
    fontWeight: face.status === 'ready' && face.weight ? face.weight : undefined,
    fontStyle: face.status === 'ready' && face.italic ? 'italic' : undefined,
    fontVariationSettings: variation,
    fontFeatureSettings: features,
    visibility: face.status === 'ready' ? ('visible' as const) : ('hidden' as const)
  }
  const shownIdx = focus ?? indexes[0]
  const shownCp = shownIdx !== undefined ? info.codePoints[shownIdx] : null

  const copy = (i: number): void => {
    navigator.clipboard.writeText(String.fromCodePoint(info.codePoints[i])).then(() => {
      setCopied(i)
      window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200)
    })
  }

  return (
    <div className="glyph-map">
      <div className="glyph-head">
        <div className="glyph-inspector">
          <div className="glyph-big" style={fontCss}>
            {shownCp !== null ? displayChar(shownCp) : ''}
          </div>
          {shownCp !== null && (
            <div className="glyph-facts">
              <div className="cell-name">{hex(shownCp)}</div>
              <div className="cell-sub">{info.names[shownIdx!] ?? 'Unnamed glyph'}</div>
              <div className="cell-sub">{blockOf(shownCp)}</div>
              <div className="cell-sub">{copied === shownIdx ? 'Copied' : 'Click a glyph to copy it'}</div>
            </div>
          )}
        </div>
        <div className="glyph-controls">
          <select className="field" value={block} onChange={(e) => (setBlock(e.target.value), setLimit(PAGE))}>
            <option value="All">All characters ({info.codePoints.length.toLocaleString()})</option>
            {blocks.map(([name, n]) => (
              <option key={name} value={name}>
                {name} ({n.toLocaleString()})
              </option>
            ))}
          </select>
          <div className="cell-sub">
            {info.glyphCount.toLocaleString()} glyphs in the font, {info.codePoints.length.toLocaleString()} mapped to
            characters
          </div>
        </div>
      </div>

      <div className="glyph-grid" onMouseLeave={() => setFocus(null)}>
        {indexes.slice(0, limit).map((i) => (
          <button
            key={i}
            className={'glyph-cell' + (i === shownIdx ? ' is-focus' : '')}
            onMouseEnter={() => setFocus(i)}
            onFocus={() => setFocus(i)}
            onClick={() => copy(i)}
            title={`${hex(info.codePoints[i])}${info.names[i] ? ' ' + info.names[i] : ''}`}
          >
            <span style={fontCss}>{displayChar(info.codePoints[i])}</span>
          </button>
        ))}
      </div>
      {indexes.length > limit && (
        <button className="button glyph-more" onClick={() => setLimit(limit + PAGE * 4)}>
          Show more ({(indexes.length - limit).toLocaleString()} left)
        </button>
      )}
    </div>
  )
}
