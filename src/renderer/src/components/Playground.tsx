import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CollectionSummary, FamilySummary, MenuItem, Pairing, RoleSettings, StyleSummary } from '@shared/api'
import { useFace } from '../fonts'
import { pairingCss } from '../pairingCss'
import type { Theme } from '../theme'

const api = window.fontlib

type Role = 'heading' | 'body'

interface Slot {
  familyId: number | null
  styleId: number | null
  settings: RoleSettings
}

const DEFAULTS: Record<Role, RoleSettings> = {
  heading: { size: 56, lineHeight: 1.1, tracking: -0.01 },
  body: { size: 18, lineHeight: 1.55, tracking: 0 }
}

const PLACEHOLDER = `<h1>The shape of a good sentence</h1>
<h2>Notes on rhythm, measure and the quiet craft of setting text</h2>
<p>Typography exists to honor content. A well-set page invites reading before a single word is understood: even color, generous margins, and a measure that lets the eye travel without strain. The heading sets the tone; the body carries the weight.</p>
<ul>
<li>Choose a body face for long reading, then a heading face that contrasts with intent.</li>
<li>Keep line length between 45 and 75 characters.</li>
<li>Let spacing, not ornament, create hierarchy.</li>
</ul>
<blockquote>“Type is a beautiful group of letters, not a group of beautiful letters.” — Matthew Carter</blockquote>
<p>Edit any of this text. It stays as you leave it until you quit the app.</p>`

// The edited document persists for the session (module state outlives the component).
let sessionDoc: string | null = null
let sessionSlots: Record<Role, Slot> | null = null
let sessionPairing: { id: number; name: string } | null = null

/**
 * Groups a family's styles by the family each font file declares (as on the family page),
 * the default style's group first, then the family's own name, then alphabetically.
 */
function groupStyles(family: FamilySummary): { name: string; styles: StyleSummary[] }[] {
  const groups: { name: string; styles: StyleSummary[] }[] = []
  for (const s of family.styles) {
    const name = s.originFamily || family.name
    const g = groups.find((x) => x.name === name)
    if (g) g.styles.push(s)
    else groups.push({ name, styles: [s] })
  }
  const rank = (g: { name: string; styles: StyleSummary[] }): number =>
    g.styles.some((s) => s.id === family.defaultStyleId) ? 0 : g.name === family.name ? 1 : 2
  return groups.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

function styleOf(families: FamilySummary[], slot: Slot): { family?: FamilySummary; style?: StyleSummary } {
  const family = families.find((f) => f.id === slot.familyId)
  const style = family?.styles.find((s) => s.id === slot.styleId) ?? family?.styles.find((s) => s.id === family.defaultStyleId)
  return { family, style }
}

/** CSS for one role, loading its face (hidden until ready, never a fallback). */
function useRoleCss(style: StyleSummary | undefined, settings: RoleSettings): CSSProperties {
  const face = useFace(style)
  const ready = face.status === 'ready'
  return {
    fontFamily: ready ? `"${face.family}"` : undefined,
    fontWeight: ready && face.weight ? face.weight : style?.weight,
    fontStyle: style?.italic ? 'italic' : undefined,
    lineHeight: settings.lineHeight,
    letterSpacing: `${settings.tracking}em`,
    fontVariationSettings: settings.variation
      ? Object.entries(settings.variation)
          .map(([t, v]) => `"${t}" ${v}`)
          .join(', ')
      : undefined,
    visibility: ready ? 'visible' : 'hidden'
  }
}

interface Props {
  families: FamilySummary[]
  collections: CollectionSummary[]
  /** A pairing to open (from a collection); consumed once. */
  openPairing: Pairing | null
  onOpened(): void
  act(task: () => Promise<unknown>): Promise<void>
  onStatus(text: string): void
  onPrompt(opts: { title: string; initial?: string; placeholder?: string; confirmLabel: string; onSubmit(v: string): void }): void
  theme: Theme
  onToggleTheme(): void
}

export function Playground(p: Props) {
  const usable = p.families.filter((f) => f.styles.length > 0)
  const initialSlots = (): Record<Role, Slot> =>
    sessionSlots ?? {
      heading: { familyId: usable[0]?.id ?? null, styleId: null, settings: DEFAULTS.heading },
      body: { familyId: (usable[1] ?? usable[0])?.id ?? null, styleId: null, settings: DEFAULTS.body }
    }
  const [slots, setSlots] = useState<Record<Role, Slot>>(initialSlots)
  const [pairing, setPairing] = useState(sessionPairing)
  const doc = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionSlots = slots
    sessionPairing = pairing
  }, [slots, pairing])

  // Restore the edited document once.
  useEffect(() => {
    if (doc.current) doc.current.innerHTML = sessionDoc ?? PLACEHOLDER
  }, [])

  // Open a pairing handed over from a collection.
  useEffect(() => {
    if (!p.openPairing) return
    const pr = p.openPairing
    setSlots({
      heading: { ...pr.heading, settings: pr.settings.heading ?? DEFAULTS.heading },
      body: { ...pr.body, settings: pr.settings.body ?? DEFAULTS.body }
    })
    setPairing({ id: pr.id, name: pr.name })
    p.onOpened()
  }, [p.openPairing])

  const h = styleOf(p.families, slots.heading)
  const b = styleOf(p.families, slots.body)
  const headingCss = useRoleCss(h.style, slots.heading.settings)
  const bodyCss = useRoleCss(b.style, slots.body.settings)

  const update = (role: Role, patch: Partial<Slot>): void =>
    setSlots((cur) => ({ ...cur, [role]: { ...cur[role], ...patch } }))
  const updateSettings = (role: Role, patch: Partial<RoleSettings>): void =>
    setSlots((cur) => ({ ...cur, [role]: { ...cur[role], settings: { ...cur[role].settings, ...patch } } }))

  const cycle = (role: Role, dir: 1 | -1): void => {
    if (usable.length === 0) return
    const i = usable.findIndex((f) => f.id === slots[role].familyId)
    const next = usable[(i + dir + usable.length) % usable.length]
    update(role, { familyId: next.id, styleId: null, settings: { ...slots[role].settings, variation: undefined } })
  }

  const swap = (): void =>
    setSlots((cur) => ({
      heading: { ...cur.body, settings: { ...cur.heading.settings, variation: cur.body.settings.variation } },
      body: { ...cur.heading, settings: { ...cur.body.settings, variation: cur.heading.settings.variation } }
    }))

  // Quick-cycle keys: [ ] step the heading font, { } (with Shift) step the body font.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '[') cycle('heading', -1)
      else if (e.key === ']') cycle('heading', 1)
      else if (e.key === '{') cycle('body', -1)
      else if (e.key === '}') cycle('body', 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const input = (): Parameters<typeof api.pairings.save>[0] | null => {
    if (!h.family || !b.family) return null
    return {
      name: pairing?.name ?? `${h.family.name} + ${b.family.name}`,
      heading: { familyId: h.family.id, styleId: h.style?.id ?? null },
      body: { familyId: b.family.id, styleId: b.style?.id ?? null },
      settings: { heading: slots.heading.settings, body: slots.body.settings }
    }
  }

  const saveAs = (): void => {
    const data = input()
    if (!data) return
    p.onPrompt({
      title: pairing ? 'Save Pairing As' : 'Save Pairing',
      initial: pairing ? `${pairing.name} copy` : data.name,
      confirmLabel: 'Save',
      onSubmit: (name) =>
        p.act(async () => {
          const id = await api.pairings.save({ ...data, name })
          setPairing({ id, name })
          p.onStatus(`Saved “${name}”`)
        })
    })
  }

  const save = (): void => {
    const data = input()
    if (!data) return
    if (!pairing) return saveAs()
    p.act(async () => {
      await api.pairings.save({ ...data, id: pairing.id, name: pairing.name })
      p.onStatus(`Saved “${pairing.name}”`)
    })
  }

  const copyCss = async (): Promise<void> => {
    if (!h.family || !b.family || !h.style || !b.style) return
    const [hf, bf] = await Promise.all([api.library.family(h.family.id), api.library.family(b.family.id)])
    if (!hf || !bf) return
    const hs = hf.styles.find((s) => s.id === h.style!.id)!
    const bs = bf.styles.find((s) => s.id === b.style!.id)!
    const css = pairingCss(
      { family: hf, style: hs, settings: slots.heading.settings },
      { family: bf, style: bs, settings: slots.body.settings },
      pairing?.name
    )
    await navigator.clipboard.writeText(css)
    p.onStatus('Pairing CSS copied')
  }

  const pairingsMenu = async (): Promise<void> => {
    const saved = await api.pairings.list()
    const items: MenuItem[] = [
      ...saved.map((s) => ({ id: `open:${s.id}`, label: s.name, type: 'checkbox' as const, checked: s.id === pairing?.id })),
      ...(saved.length ? [{ type: 'separator' as const }] : []),
      { id: 'new', label: 'New Pairing' },
      { id: 'save-as', label: 'Save As…', enabled: !!(h.family && b.family) },
      { id: 'rename', label: 'Rename…', enabled: !!pairing },
      {
        label: 'Add to Collection',
        enabled: !!pairing && p.collections.length > 0,
        submenu: p.collections.map((c) => ({ id: `col:${c.id}`, label: c.name }))
      },
      { type: 'separator' },
      { id: 'delete', label: 'Delete Pairing…', enabled: !!pairing }
    ]
    const choice = await api.ui.contextMenu(items)
    if (!choice) return
    if (choice.startsWith('open:')) {
      const pr = saved.find((s) => s.id === Number(choice.slice(5)))
      if (pr) {
        setSlots({
          heading: { ...pr.heading, settings: pr.settings.heading ?? DEFAULTS.heading },
          body: { ...pr.body, settings: pr.settings.body ?? DEFAULTS.body }
        })
        setPairing({ id: pr.id, name: pr.name })
      }
    }
    if (choice === 'new') setPairing(null)
    if (choice === 'save-as') saveAs()
    if (choice === 'rename' && pairing)
      p.onPrompt({
        title: 'Rename Pairing',
        initial: pairing.name,
        confirmLabel: 'Rename',
        onSubmit: (name) =>
          p.act(async () => {
            const data = input()
            if (data) await api.pairings.save({ ...data, id: pairing.id, name })
            setPairing({ id: pairing.id, name })
          })
      })
    if (choice.startsWith('col:') && pairing) {
      const cid = Number(choice.slice(4))
      p.act(async () => {
        await api.pairings.addToCollection(cid, pairing.id)
        p.onStatus(`Added to “${p.collections.find((c) => c.id === cid)?.name}”`)
      })
    }
    if (choice === 'delete' && pairing)
      p.act(async () => {
        if (await api.pairings.remove(pairing.id)) setPairing(null)
      })
  }

  const controls = (role: Role, label: string, sel: { family?: FamilySummary; style?: StyleSummary }) => {
    const slot = slots[role]
    const wght = sel.style?.axes.find((a) => a.tag === 'wght')
    return (
      <div className="pg-slot">
        <div className="pg-slot-head">
          <span className="pg-role">{label}</span>
          <span className="pg-keys">{role === 'heading' ? '[ ]' : '⇧[ ⇧]'}</span>
        </div>
        <div className="pg-row">
          <button className="icon-button" onClick={() => cycle(role, -1)} aria-label={`Previous ${label} font`}>
            ‹
          </button>
          <select
            className="field pg-family"
            value={slot.familyId ?? ''}
            onChange={(e) => update(role, { familyId: Number(e.target.value), styleId: null, settings: { ...slot.settings, variation: undefined } })}
          >
            {usable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="icon-button" onClick={() => cycle(role, 1)} aria-label={`Next ${label} font`}>
            ›
          </button>
        </div>
        {sel.family && sel.family.styles.length > 1 && (
          <select
            className="field pg-style"
            value={sel.style?.id ?? ''}
            onChange={(e) => update(role, { styleId: Number(e.target.value), settings: { ...slot.settings, variation: undefined } })}
          >
            {groupStyles(sel.family).map((g, _i, all) =>
              all.length > 1 ? (
                <optgroup key={g.name} label={g.name}>
                  {g.styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.styleName}
                    </option>
                  ))}
                </optgroup>
              ) : (
                g.styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.styleName}
                  </option>
                ))
              )
            )}
          </select>
        )}
        <Slider label="Size" unit="px" min={role === 'heading' ? 16 : 10} max={role === 'heading' ? 160 : 40} step={1}
          value={slot.settings.size} onChange={(v) => updateSettings(role, { size: v })} />
        <Slider label="Line height" min={0.8} max={2.4} step={0.05} value={slot.settings.lineHeight}
          onChange={(v) => updateSettings(role, { lineHeight: v })} />
        <Slider label="Tracking" unit="em" min={-0.1} max={0.3} step={0.005} value={slot.settings.tracking}
          onChange={(v) => updateSettings(role, { tracking: v })} />
        {wght && (
          <Slider label="Weight" min={wght.min} max={wght.max} step={1}
            value={slot.settings.variation?.wght ?? wght.default}
            onChange={(v) => updateSettings(role, { variation: { ...slot.settings.variation, wght: v } })} />
        )}
      </div>
    )
  }

  if (usable.length === 0) {
    return (
      <div className="family-page">
        <header className="toolbar">
          <div className="toolbar-title">Playground</div>
        </header>
        <div className="empty">
          <p className="empty-body">Add fonts to your library to pair them here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="family-page playground">
      <header className="toolbar">
        <div className="toolbar-title">
          Playground{pairing && <span className="pg-pairing-name"> · {pairing.name}</span>}
        </div>
        <button className="bar-button" onClick={swap} title="Swap heading and body fonts">
          ⇅ Swap
        </button>
        <button className="bar-button" onClick={pairingsMenu}>
          Pairings ▾
        </button>
        <button className="bar-button" onClick={save}>
          {pairing ? 'Save' : 'Save Pairing…'}
        </button>
        <button className="bar-button" onClick={copyCss}>
          Copy CSS
        </button>
        <button className="icon-button" onClick={p.onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {p.theme === 'light' ? '◐' : '◑'}
        </button>
      </header>
      <div className="family-body">
        <div className="pg-surface">
          <div
            ref={doc}
            className="pg-doc"
            contentEditable="true"
            suppressContentEditableWarning
            spellCheck={false}
            onInput={(e) => (sessionDoc = e.currentTarget.innerHTML)}
            style={
              {
                ...bodyCss,
                fontSize: `${slots.body.settings.size}px`,
                '--pg-h-family': headingCss.fontFamily,
                '--pg-h-weight': headingCss.fontWeight,
                '--pg-h-style': headingCss.fontStyle ?? 'normal',
                '--pg-h-size': `${slots.heading.settings.size}px`,
                '--pg-h-lh': slots.heading.settings.lineHeight,
                '--pg-h-track': headingCss.letterSpacing,
                '--pg-h-var': headingCss.fontVariationSettings ?? 'normal',
                '--pg-h-vis': headingCss.visibility
              } as CSSProperties
            }
          />
          <button className="link-button pg-reset" onClick={() => doc.current && ((doc.current.innerHTML = PLACEHOLDER), (sessionDoc = null))}>
            Reset text
          </button>
        </div>
        <aside className="family-panel pg-panel">
          {controls('heading', 'Heading', h)}
          {controls('body', 'Body', b)}
        </aside>
      </div>
    </div>
  )
}

function Slider(p: { label: string; unit?: string; min: number; max: number; step: number; value: number; onChange(v: number): void }) {
  const shown = p.step < 0.01 ? p.value.toFixed(3) : p.step < 1 ? p.value.toFixed(2) : String(Math.round(p.value))
  return (
    <label className="axis pg-slider">
      <span className="axis-head">
        <span>{p.label}</span>
        <span className="axis-value">
          {shown}
          {p.unit ?? ''}
        </span>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  )
}
