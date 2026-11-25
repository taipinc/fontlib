import type { FamilySummary, SourceType } from '@shared/api'
import { Specimen } from './Specimen'

export const SOURCE_LABEL: Record<SourceType, string> = {
  google: 'Google',
  adobe: 'Adobe',
  github: 'GitHub',
  file: 'File',
  system: 'System'
}

interface Props {
  families: FamilySummary[]
  text: string
  size: number
}

function styleCount(n: number): string {
  return `${n} ${n === 1 ? 'style' : 'styles'}`
}

export function FamilyGrid({ families, text, size }: Props) {
  return (
    <div className="grid" style={{ ['--cell-min' as string]: `${Math.max(260, size * 4)}px` }}>
      {families.map((f) => (
        <article key={f.id} className="grid-cell" style={{ minHeight: `${Math.round(size * 1.4 + 120)}px` }}>
          <div className="cell-marks">
            {f.isVariable && <span className="mark">Variable</span>}
            {f.sources.map((s) => (
              <span key={s} className="mark">
                {SOURCE_LABEL[s]}
              </span>
            ))}
          </div>
          <Specimen
            className="grid-specimen"
            style={f.styles.find((s) => s.id === f.defaultStyleId)}
            text={text}
            size={size}
          />
          <footer className="cell-meta">
            <div className="cell-name">{f.name}</div>
            <div className="cell-sub">{styleCount(f.styles.length)}</div>
          </footer>
        </article>
      ))}
    </div>
  )
}

export function FamilyRows({ families, text, size }: Props) {
  return (
    <div className="rows">
      {families.map((f) => (
        <article key={f.id} className="row">
          <div className="row-meta">
            <div className="cell-name">{f.name}</div>
            <div className="cell-sub">{styleCount(f.styles.length)}</div>
            <div className="row-marks">
              {f.sources.map((s) => (
                <span key={s} className="mark">
                  {SOURCE_LABEL[s]}
                </span>
              ))}
              {f.isVariable && <span className="mark">Variable</span>}
            </div>
          </div>
          <Specimen
            className="row-specimen"
            style={f.styles.find((s) => s.id === f.defaultStyleId)}
            text={text}
            size={size}
          />
        </article>
      ))}
    </div>
  )
}
