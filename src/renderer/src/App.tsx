import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionSummary, FamilySummary, ImportResult, MenuItem, Settings } from '@shared/api'
import { Sidebar, type View } from './components/Sidebar'
import { Toolbar, type Layout } from './components/Toolbar'
import { FamilyGrid, FamilyRows } from './components/FamilyGrid'
import { PromptDialog, TagDialog } from './components/Dialogs'
import { systemTheme, useApplyTheme, type Theme } from './theme'

const api = window.fontlib

/** Offered when naming a new category; categories are otherwise free text. */
const CATEGORY_PRESETS = ['Sans Serif', 'Serif', 'Slab Serif', 'Monospace', 'Display', 'Script', 'Handwriting', 'Symbol']

type Dialog =
  | { kind: 'prompt'; props: Omit<React.ComponentProps<typeof PromptDialog>, 'onCancel'> }
  | { kind: 'tags'; family: FamilySummary; allTags: string[] }

function summarize(r: ImportResult): string {
  const parts: string[] = []
  if (r.stylesAdded) parts.push(`Added ${r.stylesAdded} ${r.stylesAdded === 1 ? 'style' : 'styles'}`)
  if (r.skippedDuplicates) parts.push(`${r.skippedDuplicates} already in library`)
  if (r.errors.length) parts.push(`${r.errors.length} could not be read`)
  return parts.join(' · ') || 'No fonts found'
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    api.settings.get().then(setSettings)
  }, [])

  // Hold the first paint until settings arrive so the theme never flashes.
  if (!settings) return null
  return <Library initial={settings} />
}

function Library({ initial }: { initial: Settings }) {
  const [theme, setTheme] = useState<Theme>(initial.theme ?? systemTheme())
  const [layout, setLayout] = useState<Layout>(initial.layout ?? 'grid')
  const [previewText, setPreviewText] = useState(initial.previewText ?? 'Aa 123')
  const [size, setSize] = useState(initial.previewSize ?? 72)
  const [view, setView] = useState<View>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [families, setFamilies] = useState<FamilySummary[]>([])
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const statusTimer = useRef<number | undefined>(undefined)

  useApplyTheme(theme)

  // Persist display settings (debounced so typing in the preview field doesn't spam writes).
  useEffect(() => {
    const t = window.setTimeout(() => api.settings.set({ theme, layout, previewText, previewSize: size }), 300)
    return () => window.clearTimeout(t)
  }, [theme, layout, previewText, size])

  const refresh = useCallback(async () => {
    const [f, c] = await Promise.all([api.library.families(), api.organize.collections()])
    setFamilies(f)
    setCollections(c)
    setLoaded(true)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const showStatus = (text: string): void => {
    setStatus(text)
    window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatus(null), 6000)
  }

  /** Runs a change, refreshes, and reports failures in the status line. */
  const act = async (task: () => Promise<unknown>): Promise<void> => {
    try {
      await task()
    } catch (e) {
      showStatus((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    await refresh()
  }

  const runImport = async (task: () => Promise<ImportResult | null>): Promise<void> => {
    setBusy(true)
    setStatus('Importing…')
    try {
      const result = await task()
      if (result) {
        if (result.errors.length) console.warn('Import errors', result.errors)
        showStatus(summarize(result))
        await refresh()
      } else {
        setStatus(null)
      }
    } catch (e) {
      showStatus(`Import failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const categories = useMemo(
    () => [...new Set(families.map((f) => f.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [families]
  )

  const prompt = (props: Extract<Dialog, { kind: 'prompt' }>['props']): void => setDialog({ kind: 'prompt', props })

  const newCollection = (then?: (id: number) => Promise<unknown>): void =>
    prompt({
      title: 'New Collection',
      placeholder: 'Collection name',
      confirmLabel: 'Create',
      onSubmit: (name) => {
        setDialog(null)
        act(async () => {
          const id = await api.organize.createCollection(name, 'plain')
          if (then) await then(id)
        })
      }
    })

  const newCategory = (familyIds: number[]): void =>
    prompt({
      title: 'New Category',
      placeholder: 'Category name',
      confirmLabel: 'Set Category',
      suggestions: CATEGORY_PRESETS.filter((c) => !categories.includes(c)),
      onSubmit: (name) => {
        setDialog(null)
        act(() => api.organize.setCategory(familyIds, name))
      }
    })

  const familyMenu = async (f: FamilySummary): Promise<void> => {
    const inCollection = view.kind === 'collection' ? collections.find((c) => c.id === view.id) : undefined
    const items: MenuItem[] = [
      {
        label: 'Category',
        submenu: [
          ...categories.map((c) => ({ id: `cat:${c}`, label: c, type: 'checkbox' as const, checked: f.category === c })),
          ...(categories.length ? [{ type: 'separator' as const }] : []),
          { id: 'cat-new', label: 'New Category…' },
          { id: 'cat-none', label: 'None', enabled: f.category !== null }
        ]
      },
      {
        label: 'Add to Collection',
        submenu: [
          ...collections.map((c) => ({
            id: `col:${c.id}`,
            label: c.name,
            type: 'checkbox' as const,
            checked: c.familyIds.includes(f.id),
            enabled: !c.familyIds.includes(f.id)
          })),
          ...(collections.length ? [{ type: 'separator' as const }] : []),
          { id: 'col-new', label: 'New Collection…' }
        ]
      },
      ...(inCollection ? [{ id: 'col-remove', label: `Remove from “${inCollection.name}”` }] : []),
      { id: 'tags', label: f.tags.length ? `Edit Tags (${f.tags.length})…` : 'Add Tags…' },
      { type: 'separator' },
      {
        id: 'reveal',
        label: 'Show in Finder',
        enabled: f.sources.includes('file') || f.sources.includes('github') || f.sources.includes('system')
      },
      { type: 'separator' },
      { id: 'remove', label: 'Remove from Library…' }
    ]

    const choice = await api.ui.contextMenu(items)
    if (!choice) return
    if (choice.startsWith('cat:')) return act(() => api.organize.setCategory([f.id], choice.slice(4)))
    if (choice === 'cat-none') return act(() => api.organize.setCategory([f.id], null))
    if (choice === 'cat-new') return newCategory([f.id])
    if (choice.startsWith('col:')) return act(() => api.organize.addToCollection(Number(choice.slice(4)), [f.id]))
    if (choice === 'col-new') return newCollection((id) => api.organize.addToCollection(id, [f.id]))
    if (choice === 'col-remove' && inCollection)
      return act(() => api.organize.removeFromCollection(inCollection.id, [f.id]))
    if (choice === 'tags') {
      const all = await api.organize.tags()
      return setDialog({ kind: 'tags', family: f, allTags: all.map((t) => t.name) })
    }
    if (choice === 'reveal') return void api.library.revealFamily(f.id)
    if (choice === 'remove') return act(() => api.library.removeFamily(f.id))
  }

  const collectionMenu = async (c: CollectionSummary): Promise<void> => {
    const choice = await api.ui.contextMenu([
      { id: 'rename', label: 'Rename…' },
      { id: 'project', label: 'Project Collection', type: 'checkbox', checked: c.kind === 'project' },
      { type: 'separator' },
      { id: 'delete', label: 'Delete Collection…' }
    ])
    if (choice === 'rename')
      prompt({
        title: 'Rename Collection',
        initial: c.name,
        confirmLabel: 'Rename',
        onSubmit: (name) => {
          setDialog(null)
          act(() => api.organize.renameCollection(c.id, name))
        }
      })
    if (choice === 'project')
      act(() => api.organize.setCollectionKind(c.id, c.kind === 'project' ? 'plain' : 'project'))
    if (choice === 'delete')
      act(async () => {
        const deleted = await api.organize.deleteCollection(c.id)
        if (deleted && view.kind === 'collection' && view.id === c.id) setView({ kind: 'all' })
      })
  }

  const categoryMenu = async (name: string): Promise<void> => {
    const choice = await api.ui.contextMenu([
      { id: 'rename', label: 'Rename…' },
      { id: 'clear', label: 'Remove Category' }
    ])
    if (choice === 'rename')
      prompt({
        title: 'Rename Category',
        initial: name,
        confirmLabel: 'Rename',
        onSubmit: (to) => {
          setDialog(null)
          act(async () => {
            await api.organize.renameCategory(name, to)
            if (view.kind === 'category' && view.name === name) setView({ kind: 'category', name: to })
          })
        }
      })
    if (choice === 'clear')
      act(async () => {
        await api.organize.renameCategory(name, null)
        if (view.kind === 'category' && view.name === name) setView({ kind: 'all' })
      })
  }

  const visible = useMemo(() => {
    let list: FamilySummary[]
    switch (view.kind) {
      case 'all':
        list = families
        break
      case 'source':
        list = families.filter((f) => f.sources.includes(view.source))
        break
      case 'category':
        list = families.filter((f) => f.category === view.name)
        break
      case 'collection': {
        const byId = new Map(families.map((f) => [f.id, f]))
        const ids = collections.find((c) => c.id === view.id)?.familyIds ?? []
        list = ids.map((id) => byId.get(id)).filter((f): f is FamilySummary => !!f)
        break
      }
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((f) =>
      [f.name, f.designer, f.foundry, f.category, ...f.tags].some((v) => v?.toLowerCase().includes(q))
    )
  }, [families, collections, view, search])

  const onDrop = (e: React.DragEvent): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) runImport(() => api.library.importFiles(files))
  }

  const emptyMessage =
    view.kind === 'collection'
      ? 'This collection is empty. Drag families onto it in the sidebar, or use a family’s ••• menu.'
      : search
        ? 'No families match.'
        : 'Nothing here yet.'

  return (
    <div className="app">
      <Sidebar
        view={view}
        onSelect={setView}
        families={families}
        collections={collections}
        status={status}
        busy={busy}
        onAdd={() => runImport(() => api.library.importWithPicker())}
        onNewCollection={() => newCollection()}
        onCollectionMenu={collectionMenu}
        onCategoryMenu={categoryMenu}
        onDropOnCollection={(cid, fid) => act(() => api.organize.addToCollection(cid, [fid]))}
      />
      <main
        className={'main' + (dragging ? ' is-dragging' : '')}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={onDrop}
      >
        <Toolbar
          count={visible.length}
          search={search}
          onSearch={setSearch}
          layout={layout}
          onLayout={setLayout}
          previewText={previewText}
          onPreviewText={setPreviewText}
          size={size}
          onSize={setSize}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        />
        <section className="content">
          {loaded && families.length === 0 ? (
            <div className="empty">
              <p className="empty-title">Your library is empty</p>
              <p className="empty-body">Drop font files, folders or zips here, or use Add Fonts.</p>
            </div>
          ) : loaded && visible.length === 0 ? (
            <div className="empty">
              <p className="empty-body">{emptyMessage}</p>
            </div>
          ) : layout === 'grid' ? (
            <FamilyGrid families={visible} text={previewText || 'Aa 123'} size={size} onMenu={familyMenu} />
          ) : (
            <FamilyRows
              families={visible}
              text={previewText || 'The quick brown fox jumps over the lazy dog'}
              size={size}
              onMenu={familyMenu}
            />
          )}
        </section>
      </main>

      {dialog?.kind === 'prompt' && <PromptDialog {...dialog.props} onCancel={() => setDialog(null)} />}
      {dialog?.kind === 'tags' && (
        <TagDialog
          familyName={dialog.family.name}
          initial={dialog.family.tags}
          allTags={dialog.allTags}
          onCancel={() => setDialog(null)}
          onSubmit={(tags) => {
            const id = dialog.family.id
            setDialog(null)
            act(() => api.organize.setFamilyTags(id, tags))
          }}
        />
      )}
    </div>
  )
}
