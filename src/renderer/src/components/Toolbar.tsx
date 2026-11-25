import type { Theme } from '../theme'

export type Layout = 'grid' | 'rows'

export type SelectionAction = 'collection' | 'tags' | 'category' | 'merge' | 'remove' | 'uncollect' | 'all' | 'done'

interface Props {
  count: number
  search: string
  onSearch(v: string): void
  layout: Layout
  onLayout(v: Layout): void
  previewText: string
  onPreviewText(v: string): void
  size: number
  onSize(v: number): void
  theme: Theme
  onToggleTheme(): void
  selectionCount: number
  /** Name of the collection being viewed, if any (enables "Remove from collection"). */
  collectionName: string | null
  onSelectionAction(action: SelectionAction): void
}

function SelectionBar(p: Props) {
  const n = p.selectionCount
  const btn = (action: SelectionAction, label: string, enabled = true) => (
    <button className="bar-button" disabled={!enabled} onClick={() => p.onSelectionAction(action)}>
      {label}
    </button>
  )
  return (
    <>
      <div className="toolbar-count toolbar-count-strong">
        {n} selected
        <button className="link-button" onClick={() => p.onSelectionAction('all')}>
          Select All
        </button>
      </div>
      <div className="selection-bar">
        {btn('collection', 'Add to Collection')}
        {p.collectionName && btn('uncollect', 'Remove from Collection')}
        {btn('tags', 'Add Tags…')}
        {btn('category', 'Category')}
        {btn('merge', 'Merge…', n >= 2)}
        {btn('remove', 'Remove…')}
      </div>
      <button className="button button-primary bar-done" onClick={() => p.onSelectionAction('done')}>
        Done
      </button>
    </>
  )
}

export function Toolbar(p: Props) {
  if (p.selectionCount > 0) {
    return (
      <header className="toolbar is-selecting">
        <SelectionBar {...p} />
      </header>
    )
  }

  return (
    <header className="toolbar">
      <div className="toolbar-count">
        {p.count} {p.count === 1 ? 'Family' : 'Families'}
      </div>

      <input
        className="field toolbar-preview"
        value={p.previewText}
        onChange={(e) => p.onPreviewText(e.target.value)}
        placeholder="Preview text"
        aria-label="Preview text"
      />

      <div className="toolbar-size">
        <input
          type="range"
          min={12}
          max={200}
          value={p.size}
          onChange={(e) => p.onSize(Number(e.target.value))}
          aria-label="Preview size"
        />
        <span className="toolbar-size-value">{p.size} pt</span>
      </div>

      <div className="segmented" role="group" aria-label="Layout">
        <button className={p.layout === 'grid' ? 'is-active' : ''} onClick={() => p.onLayout('grid')}>
          Grid
        </button>
        <button className={p.layout === 'rows' ? 'is-active' : ''} onClick={() => p.onLayout('rows')}>
          Rows
        </button>
      </div>

      <button className="icon-button" onClick={p.onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
        {p.theme === 'light' ? '◐' : '◑'}
      </button>

      <input
        className="field toolbar-search"
        type="search"
        value={p.search}
        onChange={(e) => p.onSearch(e.target.value)}
        placeholder="Search"
        aria-label="Search"
      />
    </header>
  )
}
