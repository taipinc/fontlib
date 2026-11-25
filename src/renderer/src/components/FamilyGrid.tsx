import type { DragEvent, MouseEvent } from 'react'
import type { FamilySummary, SourceType } from '@shared/api'
import { FAMILY_DRAG_TYPE } from './Sidebar'
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
  onMenu(family: FamilySummary): void
}

function styleCount(n: number): string {
  return `${n} ${n === 1 ? 'style' : 'styles'}`
}

function cellHandlers(f: FamilySummary, onMenu: (f: FamilySummary) => void) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(FAMILY_DRAG_TYPE, String(f.id))
      e.dataTransfer.effectAllowed = 'copy'
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      onMenu(f)
    }
  }
}

function Marks({ f }: { f: FamilySummary }) {
  return (
    <>
      {f.isVariable && <span className="mark">Variable</span>}
      {f.sources.map((s) => (
        <span key={s} className="mark">
          {SOURCE_LABEL[s]}
        </span>
      ))}
    </>
  )
}

function MoreButton({ f, onMenu }: { f: FamilySummary; onMenu(f: FamilySummary): void }) {
  return (
    <button
      className="cell-action"
      aria-label={`Actions for ${f.name}`}
      title="Actions"
      onClick={(e) => {
        e.stopPropagation()
        onMenu(f)
      }}
    >
      •••
    </button>
  )
}

export function FamilyGrid({ families, text, size, onMenu }: Props) {
  return (
    <div className="grid" style={{ ['--cell-min' as string]: `${Math.max(260, size * 4)}px` }}>
      {families.map((f) => (
        <article
          key={f.id}
          className="grid-cell"
          style={{ minHeight: `${Math.round(size * 1.4 + 120)}px` }}
          {...cellHandlers(f, onMenu)}
        >
          <div className="cell-marks">
            <Marks f={f} />
          </div>
          <Specimen
            className="grid-specimen"
            style={f.styles.find((s) => s.id === f.defaultStyleId)}
            text={text}
            size={size}
          />
          <footer className="cell-meta">
            <div className="cell-meta-text">
              <div className="cell-name">{f.name}</div>
              <div className="cell-sub">
                {styleCount(f.styles.length)}
                {f.category && ` · ${f.category}`}
              </div>
            </div>
            <MoreButton f={f} onMenu={onMenu} />
          </footer>
        </article>
      ))}
    </div>
  )
}

export function FamilyRows({ families, text, size, onMenu }: Props) {
  return (
    <div className="rows">
      {families.map((f) => (
        <article key={f.id} className="row" {...cellHandlers(f, onMenu)}>
          <div className="row-meta">
            <div className="cell-name">{f.name}</div>
            <div className="cell-sub">
              {styleCount(f.styles.length)}
              {f.category && ` · ${f.category}`}
            </div>
            <div className="row-marks">
              <Marks f={f} />
            </div>
            {f.tags.length > 0 && <div className="row-tags">{f.tags.join(', ')}</div>}
          </div>
          <Specimen
            className="row-specimen"
            style={f.styles.find((s) => s.id === f.defaultStyleId)}
            text={text}
            size={size}
          />
          <MoreButton f={f} onMenu={onMenu} />
        </article>
      ))}
    </div>
  )
}
