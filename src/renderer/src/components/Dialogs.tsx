import { useEffect, useRef, useState, type ReactNode } from 'react'

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
