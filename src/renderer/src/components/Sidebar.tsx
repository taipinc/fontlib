import type { ReactNode } from 'react'
import type { FamilySummary, SourceType } from '@shared/api'

export type View =
  | { kind: 'all' }
  | { kind: 'source'; source: SourceType }
  | { kind: 'collection'; id: number }
  | { kind: 'category'; name: string }

const SOURCES: { type: SourceType; label: string }[] = [
  { type: 'google', label: 'Google Fonts' },
  { type: 'adobe', label: 'Adobe Fonts' },
  { type: 'github', label: 'GitHub' },
  { type: 'file', label: 'Files' },
  { type: 'system', label: 'System' }
]

interface Props {
  view: View
  onSelect(view: View): void
  families: FamilySummary[]
  status: string | null
  busy: boolean
  onAdd(): void
}

function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function Sidebar({ view, onSelect, families, status, busy, onAdd }: Props) {
  const item = (target: View, label: string, count?: number): ReactNode => (
    <button
      key={label}
      className={'sidebar-item' + (sameView(view, target) ? ' is-active' : '')}
      onClick={() => onSelect(target)}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className="sidebar-count">{count}</span>}
    </button>
  )

  const sourceCount = (t: SourceType): number => families.filter((f) => f.sources.includes(t)).length
  const categories = [...new Set(families.map((f) => f.category).filter((c): c is string => !!c))].sort()

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <nav className="sidebar-scroll">
        <div className="sidebar-group">{item({ kind: 'all' }, 'All', families.length)}</div>

        <div className="sidebar-group">
          <div className="sidebar-heading">Sources</div>
          {SOURCES.map((s) => item({ kind: 'source', source: s.type }, s.label, sourceCount(s.type)))}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">Collections</div>
          <div className="sidebar-placeholder">None yet</div>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">Categories</div>
          {categories.length === 0 ? (
            <div className="sidebar-placeholder">None yet</div>
          ) : (
            categories.map((c) =>
              item({ kind: 'category', name: c }, c, families.filter((f) => f.category === c).length)
            )
          )}
        </div>
      </nav>
      <div className="sidebar-footer">
        {status && <div className="sidebar-status">{status}</div>}
        <button className="button button-primary" onClick={onAdd} disabled={busy}>
          Add Fonts
        </button>
      </div>
    </aside>
  )
}
