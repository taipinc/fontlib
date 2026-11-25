import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AdobeKit,
  GitHubFile,
  GitHubImportResult,
  GitHubPreview,
  GooglePreview,
  StyleSummary,
  SystemFamily
} from '@shared/api'
import { parseSourceLink } from '@shared/links'
import { Specimen } from './Specimen'

function Modal({ children, onCancel }: { children: ReactNode; onCancel(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

interface PromptProps {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  suggestions?: string[]
  onSubmit(value: string): void
  onCancel(): void
}

/** A single-line text prompt (Electron has no window.prompt). */
export function PromptDialog(p: PromptProps) {
  const [value, setValue] = useState(p.initial ?? '')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])

  const submit = (v = value): void => {
    if (v.trim()) p.onSubmit(v.trim())
  }
  const shown = (p.suggestions ?? []).filter((s) => s.toLowerCase() !== value.trim().toLowerCase())

  return (
    <Modal onCancel={p.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="modal-title">{p.title}</div>
        {p.label && <label className="modal-label">{p.label}</label>}
        <input
          ref={input}
          className="field modal-input"
          value={value}
          placeholder={p.placeholder}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {shown.length > 0 && (
          <div className="chips">
            {shown.map((s) => (
              <button type="button" key={s} className="chip" onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={p.onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={!value.trim()}>
            {p.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface TagProps {
  title: string
  initial: string[]
  allTags: string[]
  onSubmit(tags: string[]): void
  onCancel(): void
}

export function TagDialog(p: TagProps) {
  const [tags, setTags] = useState<string[]>(p.initial)
  const [draft, setDraft] = useState('')

  const add = (raw: string): void => {
    const parts = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    setTags((cur) => {
      const next = [...cur]
      for (const t of parts) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t)
      return next
    })
    setDraft('')
  }

  const q = draft.trim().toLowerCase()
  const suggestions = p.allTags
    .filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()))
    .filter((t) => !q || t.toLowerCase().includes(q))
    .slice(0, 12)

  return (
    <Modal onCancel={p.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          p.onSubmit(draft.trim() ? [...tags, ...draft.split(',').map((t) => t.trim()).filter(Boolean)] : tags)
        }}
      >
        <div className="modal-title">{p.title}</div>
        <div className="tag-box">
          {tags.map((t) => (
            <span key={t} className="tag">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          ))}
          <input
            className="tag-input"
            value={draft}
            placeholder={tags.length ? '' : 'Add a tag'}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
                e.preventDefault()
                add(draft)
              } else if (e.key === 'Backspace' && !draft && tags.length) {
                setTags(tags.slice(0, -1))
              }
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="chips">
            {suggestions.map((s) => (
              <button type="button" key={s} className="chip" onClick={() => add(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="modal-hint">Press Return to add a tag.</div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={p.onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button-primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface MergeProps {
  families: { id: number; name: string; styleCount: number }[]
  onSubmit(targetId: number, newName: string | null): void
  onCancel(): void
}

/** Choose which family survives a merge, or give the result a new name. */
export function MergeDialog(p: MergeProps) {
  // Default to the family with the most styles, usually the "main" one.
  const initial = [...p.families].sort((a, b) => b.styleCount - a.styleCount)[0]
  const [target, setTarget] = useState<number | 'new'>(initial.id)
  const [newName, setNewName] = useState(initial.name)
  const total = p.families.reduce((n, f) => n + f.styleCount, 0)

  return (
    <Modal onCancel={p.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (target === 'new') {
            if (newName.trim()) p.onSubmit(initial.id, newName.trim())
          } else p.onSubmit(target, null)
        }}
      >
        <div className="modal-title">Merge {p.families.length} families</div>
        <div className="modal-label">
          All {total} styles, sources, tags and collection memberships move into one family. Keep the name:
        </div>
        <div className="radio-list">
          {p.families.map((f) => (
            <label key={f.id} className="radio-row">
              <input type="radio" name="target" checked={target === f.id} onChange={() => setTarget(f.id)} />
              <span className="radio-name">{f.name}</span>
              <span className="radio-sub">
                {f.styleCount} {f.styleCount === 1 ? 'style' : 'styles'}
              </span>
            </label>
          ))}
          <label className="radio-row">
            <input type="radio" name="target" checked={target === 'new'} onChange={() => setTarget('new')} />
            <span className="radio-name">New name</span>
          </label>
          {target === 'new' && (
            <input
              className="field modal-input radio-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={p.onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={target === 'new' && !newName.trim()}>
            Merge
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface AddProps {
  /** Prefills the link field (e.g. "Add Families…" on a saved Adobe kit). */
  initialUrl?: string
  onChooseFiles(): void
  onSystemFonts(): void
  /** Called after a Google family is added, with its id and name. */
  onAdded(familyId: number, name: string): void
  /** Called after files are imported from GitHub. */
  onImported(result: GitHubImportResult, repo: string): void
  onCancel(): void
}

type AddPhase =
  | { kind: 'idle' }
  | { kind: 'looking' }
  | { kind: 'google'; preview: GooglePreview }
  | { kind: 'adding'; preview: GooglePreview }
  | { kind: 'github'; preview: GitHubPreview; importing: boolean }
  | { kind: 'adobe'; kit: AdobeKit; importing: boolean }
  | { kind: 'error'; message: string }

function parseLinkType(url: string): string | null {
  const link = parseSourceLink(url.trim())
  return 'error' in link ? null : link.type
}

function errorText(e: unknown): string {
  return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** The single entry point for adding fonts: paste a link, or choose files. */
export function AddDialog(p: AddProps) {
  const [url, setUrl] = useState(p.initialUrl ?? '')
  const [phase, setPhase] = useState<AddPhase>({ kind: 'idle' })

  // Look the link up as soon as it parses (debounced while typing).
  useEffect(() => {
    const value = url.trim()
    if (!value) return setPhase({ kind: 'idle' })
    const link = parseSourceLink(value)
    if ('error' in link) {
      const t = window.setTimeout(() => setPhase({ kind: 'error', message: link.error }), 500)
      return () => window.clearTimeout(t)
    }
    let alive = true
    const t = window.setTimeout(() => {
      setPhase({ kind: 'looking' })
      if (link.type === 'adobe') {
        window.fontlib.adobe.preview(value).then(
          (kit) => alive && setPhase({ kind: 'adobe', kit, importing: false }),
          (e) => alive && setPhase({ kind: 'error', message: errorText(e) })
        )
      } else if (link.type === 'github') {
        window.fontlib.github.lookup(value).then(
          (preview) => alive && setPhase({ kind: 'github', preview, importing: false }),
          (e) => alive && setPhase({ kind: 'error', message: errorText(e) })
        )
      } else {
        window.fontlib.google.lookup(value).then(
          (preview) => alive && setPhase({ kind: 'google', preview }),
          (e) => alive && setPhase({ kind: 'error', message: errorText(e) })
        )
      }
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [url])

  const add = async (): Promise<void> => {
    if (phase.kind !== 'google') return
    const preview = phase.preview
    setPhase({ kind: 'adding', preview })
    try {
      const id = await window.fontlib.google.add(url.trim())
      p.onAdded(id, preview.family)
    } catch (e) {
      setPhase({ kind: 'error', message: errorText(e) })
    }
  }

  const importGitHub = async (ids: string[]): Promise<void> => {
    if (phase.kind !== 'github') return
    const preview = phase.preview
    setPhase({ kind: 'github', preview, importing: true })
    try {
      const result = await window.fontlib.github.import(url.trim(), ids)
      p.onImported(result, `${preview.owner}/${preview.repo}`)
    } catch (e) {
      setPhase({ kind: 'error', message: errorText(e) })
    }
  }

  const addAdobe = async (cssNames: string[]): Promise<void> => {
    if (phase.kind !== 'adobe') return
    const kit = phase.kit
    setPhase({ kind: 'adobe', kit, importing: true })
    try {
      const result = await window.fontlib.adobe.add(url.trim(), cssNames)
      p.onImported(result, kit.name)
    } catch (e) {
      setPhase({ kind: 'error', message: errorText(e) })
    }
  }

  const preview = phase.kind === 'google' || phase.kind === 'adding' ? phase.preview : null

  return (
    <Modal onCancel={p.onCancel}>
      <form
        className={'add-dialog' + (phase.kind === 'github' || phase.kind === 'adobe' ? ' is-wide' : '')}
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="modal-title">Add Fonts</div>
        <input
          className="field modal-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Google Fonts, GitHub or Adobe Fonts kit link"
          autoFocus
          spellCheck={false}
        />

        <div className="add-result">
          {phase.kind === 'idle' && (
            <div className="modal-hint">
              A Google Fonts specimen link (fonts.google.com/specimen/…), a GitHub repository, or an Adobe Fonts web
              project link (use.typekit.net/….css).
            </div>
          )}
          {phase.kind === 'looking' && (
            <div className="modal-hint">
              {parseLinkType(url) === 'github'
                ? 'Reading the repository and its latest release (release zips are downloaded to list their contents)…'
                : parseLinkType(url) === 'adobe'
                  ? 'Reading the web project…'
                  : 'Reading family metadata…'}
            </div>
          )}
          {phase.kind === 'error' && <div className="add-error">{phase.message}</div>}
          {phase.kind === 'github' && (
            <GitHubPicker preview={phase.preview} busy={phase.importing} onImport={importGitHub} />
          )}
          {phase.kind === 'adobe' && <AdobePicker kit={phase.kit} busy={phase.importing} onAdd={addAdobe} />}
          {preview && <GoogleCard preview={preview} />}
        </div>

        <div className="modal-actions add-actions">
          <button type="button" className="button" onClick={p.onChooseFiles}>
            Choose Files…
          </button>
          <button type="button" className="button" onClick={p.onSystemFonts}>
            System Fonts…
          </button>
          <span className="add-spacer" />
          <button type="button" className="button" onClick={p.onCancel}>
            Cancel
          </button>
          {phase.kind !== 'github' && phase.kind !== 'adobe' && (
            <button type="submit" className="button button-primary" disabled={phase.kind !== 'google'}>
              {phase.kind === 'adding' ? 'Adding…' : 'Add to Library'}
            </button>
          )}
        </div>
        <div className="modal-hint">You can also drop files, folders or zips anywhere in the window.</div>
      </form>
    </Modal>
  )
}

function GoogleCard({ preview }: { preview: GooglePreview }) {
  // A minimal style record so the shared Specimen can load the face from Google.
  const style: StyleSummary = {
    id: -1,
    postscriptName: '',
    styleName: 'Regular',
    weight: 400,
    italic: false,
    width: 5,
    isVariable: preview.axes.length > 0,
    axes: [],
    assetId: null,
    remote: { cssUrl: preview.cssUrl, family: preview.family, weight: 400, italic: false }
  }
  const facts = [
    preview.designer,
    preview.category,
    `${preview.styleCount} ${preview.styleCount === 1 ? 'style' : 'styles'}`,
    preview.axes.length ? `Variable: ${preview.axes.join(' ')}` : null
  ].filter(Boolean)
  return (
    <div className="google-card">
      <Specimen style={style} text={preview.family} size={34} />
      <div className="cell-sub">{facts.join(' · ')}</div>
      {preview.license && <div className="cell-sub">{preview.license}</div>}
      {preview.existingFamilyId !== null && (
        <div className="google-note">“{preview.family}” is already in your library. The Google source will be added to it.</div>
      )}
      <div className="cell-sub">Stored as a link only: no files are downloaded.</div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (!n) return ''
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

/** Lists a repo's font files (release first, then branch) for the user to pick from. */
export function GitHubPicker({
  preview,
  busy,
  onImport
}: {
  preview: GitHubPreview
  busy: boolean
  onImport(ids: string[]): void
}) {
  const hasRelease = preview.releaseFiles.length > 0
  const [tab, setTab] = useState<'release' | 'branch'>(hasRelease ? 'release' : 'branch')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  const files = tab === 'release' ? preview.releaseFiles : preview.branchFiles
  const q = filter.trim().toLowerCase()
  const shown = q ? files.filter((f) => f.path.toLowerCase().includes(q) || f.group.toLowerCase().includes(q)) : files

  const groups = new Map<string, GitHubFile[]>()
  for (const f of shown) {
    const key = f.group || (tab === 'release' ? 'Release files' : 'Repository root')
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  // Small listings start expanded; large ones collapsed.
  const autoOpen = shown.length <= 40

  const toggle = (ids: string[], on: boolean): void =>
    setSelected((cur) => {
      const next = new Set(cur)
      for (const id of ids) on ? next.add(id) : next.delete(id)
      return next
    })

  const selectedSize = [...preview.releaseFiles, ...preview.branchFiles]
    .filter((f) => selected.has(f.id))
    .reduce((n, f) => n + f.size, 0)

  return (
    <div className="gh">
      <div className="gh-head">
        <div className="gh-title">
          {preview.owner}/{preview.repo}
        </div>
        {preview.description && <div className="cell-sub">{preview.description}</div>}
        <div className="cell-sub">{[preview.license, preview.release && `Latest release ${preview.release.tag}`].filter(Boolean).join(' · ')}</div>
      </div>

      <div className="gh-bar">
        <div className="segmented" role="tablist">
          <button
            type="button"
            className={tab === 'release' ? 'is-active' : ''}
            disabled={!hasRelease}
            onClick={() => setTab('release')}
          >
            Release {preview.release?.tag ?? ''} ({preview.releaseFiles.length})
          </button>
          <button type="button" className={tab === 'branch' ? 'is-active' : ''} onClick={() => setTab('branch')}>
            {preview.defaultBranch} ({preview.branchFiles.length})
          </button>
        </div>
        <input
          className="field gh-filter"
          type="search"
          placeholder="Filter, e.g. ttf or Variable"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="gh-list">
        {groups.size === 0 && (
          <div className="modal-hint gh-empty">
            {files.length === 0 ? 'No font files here.' : 'No files match the filter.'}
          </div>
        )}
        {[...groups].map(([name, list]) => {
          const ids = list.map((f) => f.id)
          const count = ids.filter((id) => selected.has(id)).length
          const isOpen = open.has(name) !== autoOpen
          return (
            <div key={name} className="gh-group">
              <div className="gh-group-row">
                <input
                  type="checkbox"
                  checked={count === ids.length}
                  ref={(el) => {
                    if (el) el.indeterminate = count > 0 && count < ids.length
                  }}
                  onChange={(e) => toggle(ids, e.target.checked)}
                  aria-label={`Select all in ${name}`}
                />
                <button
                  type="button"
                  className="gh-group-name"
                  onClick={() =>
                    setOpen((cur) => {
                      const next = new Set(cur)
                      next.has(name) ? next.delete(name) : next.add(name)
                      return next
                    })
                  }
                >
                  <span className={'disclosure' + (isOpen ? ' is-open' : '')}>›</span>
                  <span className="gh-group-label">{name}</span>
                  <span className="cell-sub">
                    {count > 0 ? `${count} of ${ids.length}` : ids.length}
                  </span>
                </button>
              </div>
              {isOpen &&
                list.map((f) => (
                  <label key={f.id} className="gh-file">
                    <input type="checkbox" checked={selected.has(f.id)} onChange={(e) => toggle([f.id], e.target.checked)} />
                    <span className="gh-file-name">{f.name}</span>
                    <span className="cell-sub">{formatBytes(f.size)}</span>
                  </label>
                ))}
            </div>
          )
        })}
      </div>

      {(preview.truncated || preview.skippedArchives.length > 0) && (
        <div className="modal-hint">
          {preview.truncated && 'This repository is very large; the branch listing may be incomplete. '}
          {preview.skippedArchives.length > 0 && `Not listed (too large or unreadable): ${preview.skippedArchives.join(', ')}.`}
        </div>
      )}

      <div className="modal-actions gh-actions">
        <span className="cell-sub gh-count">
          {selected.size
            ? `${selected.size} ${selected.size === 1 ? 'file' : 'files'} · ${formatBytes(selectedSize)}`
            : 'Pick the files to import. Files already in your library are skipped.'}
        </span>
        <button
          type="button"
          className="button button-primary"
          disabled={selected.size === 0 || busy}
          onClick={() => onImport([...selected])}
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  )
}

/** Renders children only once scrolled into view (keeps long font lists light). */
function WhenVisible({ children, height }: { children: ReactNode; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (seen || !ref.current) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true)
        io.disconnect()
      }
    })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen])
  return (
    <div ref={ref} style={{ minHeight: height }}>
      {seen ? children : null}
    </div>
  )
}

interface SystemProps {
  onAdded(result: GitHubImportResult): void
  onCancel(): void
}

/** Lists installed fonts (a transient scan, never saved) and adds the chosen families by reference. */
export function SystemDialog(p: SystemProps) {
  const [families, setFamilies] = useState<SystemFamily[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [scope, setScope] = useState<'all' | 'user'>('all')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.fontlib.system.list().then(setFamilies, (e) => setError(errorText(e)))
  }, [])

  const q = filter.trim().toLowerCase()
  const shown = (families ?? []).filter(
    (f) => (scope === 'all' || f.userInstalled) && (!q || f.name.toLowerCase().includes(q))
  )

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      p.onAdded(await window.fontlib.system.add([...selected]))
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal onCancel={p.onCancel}>
      <div className="add-dialog is-wide system-dialog">
        <div className="modal-title">System Fonts</div>
        <div className="gh-bar">
          <div className="segmented">
            <button type="button" className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>
              All
            </button>
            <button type="button" className={scope === 'user' ? 'is-active' : ''} onClick={() => setScope('user')}>
              Installed by You
            </button>
          </div>
          <input
            className="field gh-filter"
            type="search"
            placeholder="Filter families"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </div>

        <div className="gh-list system-list">
          {!families && !error && <div className="modal-hint gh-empty">Reading installed fonts…</div>}
          {error && <div className="add-error gh-empty">{error}</div>}
          {families && shown.length === 0 && <div className="modal-hint gh-empty">No families match.</div>}
          {shown.map((f) => (
            <label key={f.name} className={'system-row' + (f.inLibrary ? ' is-added' : '')}>
              <input
                type="checkbox"
                disabled={f.inLibrary}
                checked={f.inLibrary || selected.has(f.name)}
                onChange={(e) =>
                  setSelected((cur) => {
                    const next = new Set(cur)
                    e.target.checked ? next.add(f.name) : next.delete(f.name)
                    return next
                  })
                }
              />
              <div className="system-name">
                <WhenVisible height={30}>
                  <Specimen
                    style={{
                      id: -f.previewFaceId,
                      postscriptName: '',
                      styleName: '',
                      weight: 400,
                      italic: false,
                      width: 5,
                      isVariable: false,
                      axes: [],
                      assetId: null,
                      previewUrl: `fontlib://system/${f.previewFaceId}`
                    }}
                    text={f.name}
                    size={22}
                  />
                </WhenVisible>
                <div className="cell-sub">
                  {f.name} · {f.styleCount} {f.styleCount === 1 ? 'style' : 'styles'}
                </div>
              </div>
              {f.inLibrary && <span className="mark">In Library</span>}
            </label>
          ))}
        </div>

        <div className="modal-hint">
          Added fonts are referenced where macOS keeps them, not copied. Many fonts that ship with macOS can’t be
          redistributed.
        </div>
        <div className="modal-actions">
          <span className="cell-sub gh-count">
            {families && `${shown.length} families`}
            {selected.size > 0 && ` · ${selected.size} selected`}
          </span>
          <button type="button" className="button" onClick={p.onCancel}>
            Cancel
          </button>
          <button type="button" className="button button-primary" disabled={!selected.size || busy} onClick={add}>
            {busy ? 'Adding…' : 'Add to Library'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** The families in an Adobe kit, to choose which to add. */
function AdobePicker({ kit, busy, onAdd }: { kit: AdobeKit; busy: boolean; onAdd(cssNames: string[]): void }) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(kit.families.filter((f) => f.familyId === null).map((f) => f.cssName))
  )
  const pending = kit.families.filter((f) => f.familyId === null)
  return (
    <div className="gh">
      <div className="gh-head">
        <div className="gh-title">{kit.name}</div>
        <div className="cell-sub">
          {kit.families.length} {kit.families.length === 1 ? 'family' : 'families'} in this web project
          {kit.syncedAt ? ' · already saved; adding more families also syncs it' : ''}
        </div>
      </div>
      <div className="gh-list">
        {kit.families.map((f) => {
          const added = f.familyId !== null
          return (
            <label key={f.cssName} className={'system-row' + (added ? ' is-added' : '')}>
              <input
                type="checkbox"
                disabled={added}
                checked={added || selected.has(f.cssName)}
                onChange={(e) =>
                  setSelected((cur) => {
                    const next = new Set(cur)
                    e.target.checked ? next.add(f.cssName) : next.delete(f.cssName)
                    return next
                  })
                }
              />
              <div className="system-name">
                <AdobeSample kitUrl={kit.url} cssName={f.cssName} text={f.displayName} />
                <div className="cell-sub">
                  font-family: {f.cssName} · {f.styleCount} {f.styleCount === 1 ? 'style' : 'styles'}
                </div>
              </div>
              {added && <span className="mark">In Library</span>}
            </label>
          )
        })}
      </div>
      <div className="modal-hint">Adobe families are links only: previews load through the kit, and no files are downloaded.</div>
      <div className="modal-actions gh-actions">
        <span className="cell-sub gh-count">
          {pending.length === 0 ? 'Every family in this kit is in your library.' : `${selected.size} selected`}
        </span>
        <button
          type="button"
          className="button button-primary"
          disabled={busy || (selected.size === 0 && kit.syncedAt === null)}
          onClick={() => onAdd([...selected])}
        >
          {busy ? 'Adding…' : selected.size ? `Add ${selected.size} ${selected.size === 1 ? 'Family' : 'Families'}` : 'Save Kit'}
        </button>
      </div>
    </div>
  )
}

/** A family name set in its Adobe font, loaded through the kit stylesheet. */
export function AdobeSample({ kitUrl, cssName, text, size = 22 }: { kitUrl: string; cssName: string; text: string; size?: number }) {
  const style: StyleSummary = {
    id: -1,
    postscriptName: '',
    styleName: 'Regular',
    weight: 400,
    italic: false,
    width: 5,
    isVariable: false,
    axes: [],
    assetId: null,
    remote: { cssUrl: kitUrl, family: cssName, weight: 400, italic: false }
  }
  return <Specimen style={style} text={text} size={size} />
}
