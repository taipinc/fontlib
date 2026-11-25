import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FamilySummary, ImportResult, Settings } from '@shared/api'
import { Sidebar, type View } from './components/Sidebar'
import { Toolbar, type Layout } from './components/Toolbar'
import { FamilyGrid, FamilyRows } from './components/FamilyGrid'
import { systemTheme, useApplyTheme, type Theme } from './theme'

const api = window.fontlib

function summarize(r: ImportResult): string {
  const parts: string[] = []
  if (r.stylesAdded) parts.push(`Added ${r.stylesAdded} ${r.stylesAdded === 1 ? 'style' : 'styles'}`)
  if (r.skippedDuplicates) parts.push(`${r.skippedDuplicates} already in library`)
  if (r.errors.length) parts.push(`${r.errors.length} could not be read`)
  return parts.join(' · ') || 'No fonts found'
}

function matchesView(f: FamilySummary, view: View): boolean {
  switch (view.kind) {
    case 'all':
      return true
    case 'source':
      return f.sources.includes(view.source)
    case 'category':
      return f.category === view.name
    case 'collection':
      return false
  }
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
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const statusTimer = useRef<number | undefined>(undefined)

  useApplyTheme(theme)

  // Persist display settings (debounced so typing in the preview field doesn't spam writes).
  useEffect(() => {
    const t = window.setTimeout(() => api.settings.set({ theme, layout, previewText, previewSize: size }), 300)
    return () => window.clearTimeout(t)
  }, [theme, layout, previewText, size])

  const refresh = useCallback(async () => {
    setFamilies(await api.library.families())
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return families.filter(
      (f) =>
        matchesView(f, view) &&
        (!q || [f.name, f.designer, f.foundry].some((v) => v?.toLowerCase().includes(q)))
    )
  }, [families, view, search])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) runImport(() => api.library.importFiles(files))
  }

  return (
    <div className="app">
      <Sidebar
        view={view}
        onSelect={setView}
        families={families}
        status={status}
        busy={busy}
        onAdd={() => runImport(() => api.library.importWithPicker())}
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
          if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
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
              <p className="empty-body">No families match.</p>
            </div>
          ) : layout === 'grid' ? (
            <FamilyGrid families={visible} text={previewText || 'Aa 123'} size={size} />
          ) : (
            <FamilyRows
              families={visible}
              text={previewText || 'The quick brown fox jumps over the lazy dog'}
              size={size}
            />
          )}
        </section>
      </main>
    </div>
  )
}
