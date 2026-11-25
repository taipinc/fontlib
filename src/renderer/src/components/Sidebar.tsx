import type { ReactNode } from 'react'

export type SourceType = 'google' | 'adobe' | 'github' | 'file' | 'system'

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
}

function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function Sidebar({ view, onSelect }: Props) {
  const item = (target: View, label: string, count?: number): ReactNode => (
    <button
      key={label}
      className={'sidebar-item' + (sameView(view, target) ? ' is-active' : '')}
      onClick={() => onSelect(target)}
    >
      <span>{label}</span>
      {count !== undefined && <span className="sidebar-count">{count}</span>}
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <nav className="sidebar-scroll">
        <div className="sidebar-group">{item({ kind: 'all' }, 'All')}</div>

        <div className="sidebar-group">
          <div className="sidebar-heading">Sources</div>
          {SOURCES.map((s) => item({ kind: 'source', source: s.type }, s.label))}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">Collections</div>
          <div className="sidebar-placeholder">None yet</div>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">Categories</div>
          <div className="sidebar-placeholder">None yet</div>
        </div>
      </nav>
      <div className="sidebar-footer">
        <button className="button button-primary">Add Fonts</button>
      </div>
    </aside>
  )
}
