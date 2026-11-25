import { useState, type ReactNode } from 'react'
import type { CollectionSummary, FamilySummary, SourceType } from '@shared/api'

export type View =
  | { kind: 'all' }
  | { kind: 'source'; source: SourceType }
  | { kind: 'collection'; id: number }
  | { kind: 'category'; name: string }
  | { kind: 'tag'; name: string }
  | { kind: 'playground' }

const SOURCES: { type: SourceType; label: string }[] = [
  { type: 'google', label: 'Google Fonts' },
  { type: 'adobe', label: 'Adobe Fonts' },
  { type: 'github', label: 'GitHub' },
  { type: 'file', label: 'Files' },
  { type: 'system', label: 'System' }
]

/** MIME type used when dragging family cells onto sidebar collections. */
export const FAMILY_DRAG_TYPE = 'application/x-fontlib-family'

interface Props {
  view: View
  onSelect(view: View): void
  families: FamilySummary[]
  collections: CollectionSummary[]
  status: string | null
  busy: boolean
  onAdd(): void
  onNewCollection(): void
  onCollectionMenu(c: CollectionSummary): void
  onCategoryMenu(name: string): void
  onTagMenu(name: string): void
  onDropOnCollection(collectionId: number, familyId: number): void
}

function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function Sidebar(p: Props) {
  const { view, families, collections } = p
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  const item = (
    target: View,
    label: string,
    count?: number,
    extra?: Partial<React.ButtonHTMLAttributes<HTMLButtonElement>>,
    badge?: ReactNode
  ): ReactNode => (
    <button
      key={JSON.stringify(target)}
      className={'sidebar-item' + (sameView(view, target) ? ' is-active' : '')}
      onClick={() => p.onSelect(target)}
      {...extra}
    >
      <span className="sidebar-label">{label}</span>
      {badge}
      {count !== undefined && count > 0 && <span className="sidebar-count">{count}</span>}
    </button>
  )

  const sourceCount = (t: SourceType): number => families.filter((f) => f.sources.includes(t)).length
  const tagCounts = new Map<string, number>()
  for (const f of families) for (const t of f.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  const tags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  const categories = [...new Set(families.map((f) => f.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b)
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <nav className="sidebar-scroll">
        <div className="sidebar-group">
          {item({ kind: 'all' }, 'All', families.length)}
          {item({ kind: 'playground' }, 'Playground')}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">Sources</div>
          {SOURCES.map((s) => item({ kind: 'source', source: s.type }, s.label, sourceCount(s.type)))}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">
            <span>Collections</span>
            <button className="sidebar-heading-action" onClick={p.onNewCollection} title="New Collection">
              +
            </button>
          </div>
          {collections.length === 0 ? (
            <div className="sidebar-placeholder">None yet</div>
          ) : (
            collections.map((c) =>
              item(
                { kind: 'collection', id: c.id },
                c.name,
                c.familyIds.length,
                {
                  className:
                    'sidebar-item' +
                    (sameView(view, { kind: 'collection', id: c.id }) ? ' is-active' : '') +
                    (dropTarget === c.id ? ' is-drop-target' : ''),
                  onContextMenu: (e) => {
                    e.preventDefault()
                    p.onCollectionMenu(c)
                  },
                  onDragOver: (e) => {
                    if (e.dataTransfer.types.includes(FAMILY_DRAG_TYPE)) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'copy'
                      setDropTarget(c.id)
                    }
                  },
                  onDragLeave: () => setDropTarget(null),
                  onDrop: (e) => {
                    e.preventDefault()
                    setDropTarget(null)
                    const id = Number(e.dataTransfer.getData(FAMILY_DRAG_TYPE))
                    if (Number.isInteger(id) && id > 0) p.onDropOnCollection(c.id, id)
                  }
                }
              )
            )
          )}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">
            <span>Tags</span>
          </div>
          {tags.length === 0 ? (
            <div className="sidebar-placeholder">None yet</div>
          ) : (
            tags.map((t) =>
              item({ kind: 'tag', name: t }, t, tagCounts.get(t), {
                onContextMenu: (e) => {
                  e.preventDefault()
                  p.onTagMenu(t)
                }
              })
            )
          )}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">
            <span>Categories</span>
          </div>
          {categories.length === 0 ? (
            <div className="sidebar-placeholder">None yet</div>
          ) : (
            categories.map((c) =>
              item({ kind: 'category', name: c }, c, families.filter((f) => f.category === c).length, {
                onContextMenu: (e) => {
                  e.preventDefault()
                  p.onCategoryMenu(c)
                }
              })
            )
          )}
        </div>
      </nav>
      <div className="sidebar-footer">
        {p.status && <div className="sidebar-status">{p.status}</div>}
        <button className="button button-primary" onClick={p.onAdd} disabled={p.busy}>
          Add Fonts
        </button>
      </div>
    </aside>
  )
}
