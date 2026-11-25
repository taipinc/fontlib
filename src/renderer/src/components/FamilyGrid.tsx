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
  selected: Set<number>
  onMenu(family: FamilySummary): void
  onClick(family: FamilySummary, e: MouseEvent): void
  onToggle(family: FamilySummary, e: MouseEvent): void
}

function styleCount(n: number): string {
  return `${n} ${n === 1 ? 'style' : 'styles'}`
}

function cellHandlers(f: FamilySummary, p: Props) {
  const { onMenu } = p
  return {
    draggable: true,
    onClick: (e: MouseEvent) => p.onClick(f, e),
    'aria-selected': p.selected.has(f.id),
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

function CheckButton({ f, p }: { f: FamilySummary; p: Props }) {
  const on = p.selected.has(f.id)
  return (
    <button
      className={'cell-check' + (on ? ' is-on' : '')}
      role="checkbox"
      aria-checked={on}
      aria-label={`Select ${f.name}`}
      onClick={(e) => {
        e.stopPropagation()
        p.onToggle(f, e)
      }}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 6.2l2.3 2.3 4.7-5" />
      </svg>
    </button>
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

export function FamilyGrid(p: Props) {
  const { families, text, size, onMenu } = p
  return (
    <div className={'grid' + (p.selected.size ? ' is-selecting' : '')} style={{ ['--cell-min' as string]: `${Math.max(260, size * 4)}px` }}>
      {families.map((f) => (
        <article
          key={f.id}
          className={'grid-cell' + (p.selected.has(f.id) ? ' is-selected' : '')}
          style={{ minHeight: `${Math.round(size * 1.4 + 120)}px` }}
          {...cellHandlers(f, p)}
        >
          <CheckButton f={f} p={p} />
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

export function FamilyRows(p: Props) {
  const { families, text, size, onMenu } = p
  return (
    <div className={'rows' + (p.selected.size ? ' is-selecting' : '')}>
      {families.map((f) => (
        <article
          key={f.id}
          className={'row' + (p.selected.has(f.id) ? ' is-selected' : '')}
          {...cellHandlers(f, p)}
        >
          <CheckButton f={f} p={p} />
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
