import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionSummary, FamilySummary, ImportResult, MenuItem, Settings } from '@shared/api'
import { Sidebar, type View } from './components/Sidebar'
import { Toolbar, type Layout, type SelectionAction } from './components/Toolbar'
import { FamilyGrid, FamilyRows } from './components/FamilyGrid'
import { AddDialog, MergeDialog, PromptDialog, TagDialog } from './components/Dialogs'
import { FamilyPage } from './components/FamilyPage'
import { systemTheme, useApplyTheme, type Theme } from './theme'

const api = window.fontlib

/** Offered when naming a new category; categories are otherwise free text. */
const CATEGORY_PRESETS = ['Sans Serif', 'Serif', 'Slab Serif', 'Monospace', 'Display', 'Script', 'Handwriting', 'Symbol']

type Dialog =
  | { kind: 'prompt'; props: Omit<React.ComponentProps<typeof PromptDialog>, 'onCancel'> }
  | { kind: 'tags'; title: string; familyIds: number[]; mode: 'set' | 'add'; initial: string[]; allTags: string[] }
  | { kind: 'merge'; familyIds: number[] }
  | { kind: 'add' }

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
  const [familyPanel, setFamilyPanel] = useState(initial.familyPanel ?? false)
  const [view, setView] = useState<View>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [families, setFamilies] = useState<FamilySummary[]>([])
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [openFamily, setOpenFamily] = useState<number | null>(null)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const anchor = useRef<number | null>(null)
  const statusTimer = useRef<number | undefined>(undefined)

  useApplyTheme(theme)

  // Persist display settings (debounced so typing in the preview field doesn't spam writes).
  useEffect(() => {
    const t = window.setTimeout(
      () => api.settings.set({ theme, layout, previewText, previewSize: size, familyPanel }),
      300
    )
    return () => window.clearTimeout(t)
  }, [theme, layout, previewText, size, familyPanel])

  const refresh = useCallback(async () => {
    const [f, c] = await Promise.all([api.library.families(), api.organize.collections()])
    setFamilies(f)
    setCollections(c)
    setLoaded(true)
    setRevision((r) => r + 1)
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

  const clearSelection = (): void => {
    setSelected(new Set())
    anchor.current = null
  }

  const toggle = (f: FamilySummary): void => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(f.id)) next.delete(f.id)
      else next.add(f.id)
      return next
    })
    anchor.current = f.id
  }

  /** ⇧-click selects the range from the last toggled family to this one, in display order. */
  const selectRange = (f: FamilySummary): void => {
    const order = visible.map((x) => x.id)
    const from = anchor.current !== null ? order.indexOf(anchor.current) : -1
    const to = order.indexOf(f.id)
    if (from < 0 || to < 0) return toggle(f)
    const [a, b] = from < to ? [from, to] : [to, from]
    setSelected((cur) => new Set([...cur, ...order.slice(a, b + 1)]))
  }

  const onCellClick = (f: FamilySummary, e: React.MouseEvent): void => {
    if (e.shiftKey) return selectRange(f)
    if (e.metaKey || selected.size > 0) return toggle(f)
    setOpenFamily(f.id)
  }

  const onToggle = (f: FamilySummary, e: React.MouseEvent): void => (e.shiftKey ? selectRange(f) : toggle(f))

  const categoryItems = (current: string | null | undefined): MenuItem[] => [
    ...categories.map((c) => ({ id: `cat:${c}`, label: c, type: 'checkbox' as const, checked: current === c })),
    ...(categories.length ? [{ type: 'separator' as const }] : []),
    { id: 'cat-new', label: 'New Category…' },
    { id: 'cat-none', label: 'None', enabled: current !== null }
  ]

  const collectionItems = (familyIds: number[]): MenuItem[] => [
    ...collections.map((c) => {
      const all = familyIds.every((id) => c.familyIds.includes(id))
      return { id: `col:${c.id}`, label: c.name, type: 'checkbox' as const, checked: all, enabled: !all }
    }),
    ...(collections.length ? [{ type: 'separator' as const }] : []),
    { id: 'col-new', label: 'New Collection…' }
  ]

  /** Handles category/collection menu choices for any set of families. */
  const applyChoice = (choice: string | null, familyIds: number[]): boolean => {
    if (!choice) return true
    if (choice.startsWith('cat:')) return void act(() => api.organize.setCategory(familyIds, choice.slice(4))), true
    if (choice === 'cat-none') return void act(() => api.organize.setCategory(familyIds, null)), true
    if (choice === 'cat-new') return newCategory(familyIds), true
    if (choice.startsWith('col:'))
      return void act(() => api.organize.addToCollection(Number(choice.slice(4)), familyIds)), true
    if (choice === 'col-new') return newCollection((id) => api.organize.addToCollection(id, familyIds)), true
    return false
  }

  const openTags = async (familyIds: number[], mode: 'set' | 'add'): Promise<void> => {
    const all = (await api.organize.tags()).map((t) => t.name)
    const f = families.find((x) => x.id === familyIds[0])
    setDialog({
      kind: 'tags',
      familyIds,
      mode,
      allTags: all,
      initial: mode === 'set' ? (f?.tags ?? []) : [],
      title: mode === 'set' ? `Tags for ${f?.name ?? ''}` : `Add tags to ${familyIds.length} families`
    })
  }

  const selectionAction = async (action: SelectionAction): Promise<void> => {
    const ids = visible.filter((f) => selected.has(f.id)).map((f) => f.id)
    const inCollection = view.kind === 'collection' ? collections.find((c) => c.id === view.id) : undefined
    switch (action) {
      case 'done':
        return clearSelection()
      case 'all':
        return setSelected(new Set(visible.map((f) => f.id)))
      case 'collection':
        return void applyChoice(await api.ui.contextMenu(collectionItems(ids)), ids)
      case 'category': {
        const cats = new Set(families.filter((f) => ids.includes(f.id)).map((f) => f.category))
        return void applyChoice(await api.ui.contextMenu(categoryItems(cats.size === 1 ? [...cats][0] : undefined)), ids)
      }
      case 'tags':
        return openTags(ids, 'add')
      case 'merge':
        return setDialog({ kind: 'merge', familyIds: ids })
      case 'uncollect':
        if (inCollection) await act(() => api.organize.removeFromCollection(inCollection.id, ids))
        return clearSelection()
      case 'remove':
        return act(async () => {
          if (await api.organize.removeFamilies(ids)) clearSelection()
        })
    }
  }

  const familyMenu = async (f: FamilySummary): Promise<void> => {
    if (selected.has(f.id) && selected.size > 1) {
      const choice = await api.ui.contextMenu([
        { label: `${selected.size} selected`, enabled: false },
        { type: 'separator' },
        { label: 'Category', submenu: categoryItems(undefined) },
        { label: 'Add to Collection', submenu: collectionItems([...selected]) },
        { id: 'tags', label: 'Add Tags…' },
        { id: 'merge', label: 'Merge…' },
        { type: 'separator' },
        { id: 'remove', label: 'Remove from Library…' }
      ])
      if (choice === 'tags' || choice === 'merge' || choice === 'remove') return selectionAction(choice)
      applyChoice(choice, [...selected])
      return
    }
    const inCollection = view.kind === 'collection' ? collections.find((c) => c.id === view.id) : undefined
    const items: MenuItem[] = [
      { id: 'open', label: 'Open' },
      { type: 'separator' },
      { label: 'Category', submenu: categoryItems(f.category) },
      { label: 'Add to Collection', submenu: collectionItems([f.id]) },
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
    if (applyChoice(choice, [f.id]) || !choice) return
    if (choice === 'open') return setOpenFamily(f.id)
    if (choice === 'col-remove' && inCollection)
      return act(() => api.organize.removeFromCollection(inCollection.id, [f.id]))
    if (choice === 'tags') return openTags([f.id], 'set')
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

  const tagMenu = async (name: string): Promise<void> => {
    const choice = await api.ui.contextMenu([
      { id: 'rename', label: 'Rename…' },
      { id: 'delete', label: 'Delete Tag…' }
    ])
    if (choice === 'rename')
      prompt({
        title: 'Rename Tag',
        initial: name,
        confirmLabel: 'Rename',
        onSubmit: (to) => {
          setDialog(null)
          act(async () => {
            await api.organize.renameTag(name, to)
            if (view.kind === 'tag' && view.name === name) setView({ kind: 'tag', name: to })
          })
        }
      })
    if (choice === 'delete')
      act(async () => {
        const deleted = await api.organize.deleteTag(name)
        if (deleted && view.kind === 'tag' && view.name === name) setView({ kind: 'all' })
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
      case 'tag':
        list = families.filter((f) => f.tags.includes(view.name))
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

  // Selection is per view; drop it when the view changes or families disappear.
  useEffect(() => clearSelection(), [view])
  useEffect(() => {
    setSelected((cur) => {
      const ids = new Set(families.map((f) => f.id))
      const next = new Set([...cur].filter((id) => ids.has(id)))
      return next.size === cur.size ? cur : next
    })
  }, [families])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (dialog) return
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
      if (openFamily !== null) {
        if (e.key === 'Escape' && !typing) setOpenFamily(null)
        return
      }
      if (e.key === 'Escape' && selected.size) clearSelection()
      if (e.key === 'a' && e.metaKey && !typing) {
        e.preventDefault()
        setSelected(new Set(visible.map((f) => f.id)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, selected, visible, openFamily])

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
        onSelect={(v) => {
          setView(v)
          setOpenFamily(null)
        }}
        families={families}
        collections={collections}
        status={status}
        busy={busy}
        onAdd={() => setDialog({ kind: 'add' })}
        onNewCollection={() => newCollection()}
        onCollectionMenu={collectionMenu}
        onCategoryMenu={categoryMenu}
        onTagMenu={tagMenu}
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
        {openFamily !== null ? (
          <FamilyPage
            familyId={openFamily}
            revision={revision}
            families={families}
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            onBack={() => setOpenFamily(null)}
            act={act}
            onOpenFamily={setOpenFamily}
            panelOpen={familyPanel}
            onTogglePanel={() => setFamilyPanel((v) => !v)}
            onCategoryMenu={async (id, current) => applyChoice(await api.ui.contextMenu(categoryItems(current)), [id])}
            onEditTags={(id) => openTags([id], 'set')}
            onPrompt={(opts) =>
              prompt({
                ...opts,
                onSubmit: (v) => {
                  setDialog(null)
                  opts.onSubmit(v)
                }
              })
            }
          />
        ) : (
          <>
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
              selectionCount={selected.size}
              collectionName={
                view.kind === 'collection' ? (collections.find((c) => c.id === view.id)?.name ?? null) : null
              }
              onSelectionAction={selectionAction}
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
                <FamilyGrid
                  families={visible}
                  text={previewText || 'Aa 123'}
                  size={size}
                  selected={selected}
                  onMenu={familyMenu}
                  onClick={onCellClick}
                  onToggle={onToggle}
                />
              ) : (
                <FamilyRows
                  families={visible}
                  text={previewText || 'The quick brown fox jumps over the lazy dog'}
                  size={size}
                  selected={selected}
                  onMenu={familyMenu}
                  onClick={onCellClick}
                  onToggle={onToggle}
                />
              )}
            </section>
          </>
        )}
      </main>

      {dialog?.kind === 'prompt' && <PromptDialog {...dialog.props} onCancel={() => setDialog(null)} />}
      {dialog?.kind === 'tags' && (
        <TagDialog
          title={dialog.title}
          initial={dialog.initial}
          allTags={dialog.allTags}
          onCancel={() => setDialog(null)}
          onSubmit={(tags) => {
            const { familyIds, mode } = dialog
            setDialog(null)
            act(() =>
              mode === 'set'
                ? api.organize.setFamilyTags(familyIds[0], tags)
                : api.organize.addTags(familyIds, tags)
            )
          }}
        />
      )}
      {dialog?.kind === 'add' && (
        <AddDialog
          onCancel={() => setDialog(null)}
          onChooseFiles={() => {
            setDialog(null)
            runImport(() => api.library.importWithPicker())
          }}
          onImported={async (result, repo) => {
            setDialog(null)
            if (result.errors.length) console.warn('Import errors', result.errors)
            await refresh()
            showStatus(`${repo}: ${summarize(result)}`)
            if (result.familyIds.length === 1) setOpenFamily(result.familyIds[0])
          }}
          onAdded={async (id, name) => {
            setDialog(null)
            await refresh()
            showStatus(`Added ${name} from Google Fonts`)
            setOpenFamily(id)
          }}
        />
      )}
      {dialog?.kind === 'merge' && (
        <MergeDialog
          families={families
            .filter((f) => dialog.familyIds.includes(f.id))
            .map((f) => ({ id: f.id, name: f.name, styleCount: f.styles.length }))}
          onCancel={() => setDialog(null)}
          onSubmit={(targetId, newName) => {
            const ids = dialog.familyIds
            setDialog(null)
            act(async () => {
              await api.organize.merge(ids, targetId, newName)
              clearSelection()
              showStatus(`Merged ${ids.length} families`)
            })
          }}
        />
      )}
    </div>
  )
}
