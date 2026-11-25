import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { FamilyDetail, FamilyPatch, FamilySummary, MenuItem, SourceType, StyleDetail } from '@shared/api'
import { DEFAULT_ON, featureName, featureSettings, userFeatures } from '../features'
import { variationCss } from '../fonts'
import type { Theme } from '../theme'
import { SOURCE_LABEL } from './FamilyGrid'
import { GlyphMap } from './GlyphMap'
import { Specimen } from './Specimen'

const api = window.fontlib

const SAMPLE = 'The quick brown fox jumps over the lazy dog'

interface Props {
  familyId: number
  /** Bumps whenever the library changes, so the page refetches. */
  revision: number
  families: FamilySummary[]
  theme: Theme
  onToggleTheme(): void
  onBack(): void
  act(task: () => Promise<unknown>): Promise<void>
  onCategoryMenu(familyId: number, current: string | null): void
  onEditTags(familyId: number): void
  onPrompt(opts: { title: string; placeholder?: string; initial?: string; confirmLabel: string; label?: string; onSubmit(v: string): void }): void
  onOpenFamily(id: number): void
  panelOpen: boolean
  onTogglePanel(): void
}

function styleLabel(s: StyleDetail): string {
  return s.styleName
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/** A text field that saves on blur or Return (Esc reverts). */
function InlineField({
  value,
  placeholder,
  multiline,
  onSave
}: {
  value: string | null
  placeholder: string
  multiline?: boolean
  onSave(v: string | null): void
}) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = (): void => {
    const next = draft.trim() ? draft : null
    if (next !== (value ?? null)) onSave(next)
  }
  const common = {
    className: 'inline-field' + (multiline ? ' inline-field-multi' : ''),
    value: draft,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setDraft(value ?? '')
        ;(e.target as HTMLElement).blur()
      }
      if (e.key === 'Enter' && !multiline) (e.target as HTMLElement).blur()
    }
  }
  return multiline ? <textarea rows={4} {...common} /> : <input {...common} />
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel-section">
      <div className="panel-heading">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="panel-row">
      <div className="panel-label">{label}</div>
      <div className="panel-value">{children}</div>
    </div>
  )
}

const SOURCE_NAME: Record<SourceType, string> = {
  google: 'Google Fonts',
  adobe: 'Adobe Fonts',
  github: 'GitHub',
  file: 'Local files',
  system: 'System'
}

export function FamilyPage(p: Props) {
  const [family, setFamily] = useState<FamilyDetail | null>(null)
  const [styleId, setStyleId] = useState<number | null>(null)
  const [text, setText] = useState(SAMPLE)
  const [size, setSize] = useState(88)
  const [axes, setAxes] = useState<Record<string, number>>({})
  const [featureState, setFeatureState] = useState<Record<string, boolean>>({})
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [tab, setTab] = useState<'styles' | 'glyphs'>('styles')

  useEffect(() => {
    let alive = true
    api.library.family(p.familyId).then((f) => {
      if (!alive) return
      if (!f) return p.onBack()
      setFamily(f)
      setStyleId((cur) => (cur && f.styles.some((s) => s.id === cur) ? cur : f.defaultStyleId))
    })
    return () => {
      alive = false
    }
  }, [p.familyId, p.revision])

  const style = family?.styles.find((s) => s.id === styleId) ?? family?.styles[0]

  // Axes and features reset when the style changes: to the saved default's axis values for the
  // family's default style, otherwise to the font's own defaults.
  useEffect(() => {
    if (!style) return
    const saved = family?.defaultStyleId === style.id ? (family?.defaultVariation ?? {}) : {}
    setAxes(Object.fromEntries(style.axes.map((a) => [a.tag, saved[a.tag] ?? a.default])))
    setFeatureState(Object.fromEntries(userFeatures(style.features).map((t) => [t, DEFAULT_ON.has(t)])))
  }, [style?.id])

  const variation = useMemo(() => {
    if (!style?.axes.length) return undefined
    return style.axes.map((a) => `"${a.tag}" ${axes[a.tag] ?? a.default}`).join(', ')
  }, [style, axes])
  const featureCss = featureSettings(featureState)

  if (!family || !style) return <div className="family-page" />

  const save = (patch: FamilyPatch): Promise<void> => p.act(() => api.library.updateFamily(family.id, patch))
  const scripts = [...new Set(family.styles.flatMap((s) => s.scripts))]
  const glyphs = Math.max(0, ...family.styles.map((s) => s.glyphCount ?? 0))
  const featureList = userFeatures(style.features)
  const changedFeatures = featureList.filter((t) => !!featureState[t] !== DEFAULT_ON.has(t)).length

  // Merged families group their styles by the family each font file declares.
  // The family's own name comes first, the rest alphabetically.
  // The default style leads the list (and its group leads when grouped).
  const ordered = [...family.styles].sort((a, b) =>
    a.id === family.defaultStyleId ? -1 : b.id === family.defaultStyleId ? 1 : 0
  )
  const groups: { name: string; styles: StyleDetail[] }[] = []
  for (const s of ordered) {
    const name = s.originFamily || family.name
    const g = groups.find((x) => x.name === name)
    if (g) g.styles.push(s)
    else groups.push({ name, styles: [s] })
  }
  const rank = (g: { name: string; styles: StyleDetail[] }): number =>
    g.styles.some((s) => s.id === family.defaultStyleId) ? 0 : g.name === family.name ? 1 : 2
  groups.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const grouped = groups.length > 1

  // "Set as Default" is done once the current style and axis values match what's saved.
  const savedAxes = family.defaultVariation ?? {}
  const isDefault =
    family.hasSavedDefault &&
    style.id === family.defaultStyleId &&
    style.axes.every((a) => (savedAxes[a.tag] ?? a.default) === (axes[a.tag] ?? a.default))
  const saveDefault = (): Promise<void> =>
    p.act(() =>
      api.library.setDefaultStyle(
        family.id,
        style.id,
        style.axes.length ? Object.fromEntries(style.axes.map((a) => [a.tag, axes[a.tag] ?? a.default])) : null
      )
    )

  const styleMenu = async (s: StyleDetail): Promise<void> => {
    const others = p.families.filter((f) => f.id !== family.id)
    const items: MenuItem[] = [
      { id: 'preview', label: 'Preview This Style', enabled: s.id !== style.id },
      {
        label: 'Move to Family',
        submenu: [
          { id: 'move-new', label: 'New Family…' },
          ...(others.length ? [{ type: 'separator' as const }] : []),
          ...others.map((f) => ({ id: `move:${f.id}`, label: f.name }))
        ]
      },
      { type: 'separator' },
      ...s.assets.map((a) => ({
        id: `reveal:${a.id}`,
        label: `Show ${a.kind.toUpperCase()} in Finder`,
        enabled: a.storage !== 'remote' && !a.missing
      }))
    ]
    const choice = await api.ui.contextMenu(items)
    if (!choice) return
    if (choice === 'preview') setStyleId(s.id)
    if (choice.startsWith('reveal:')) api.library.revealAsset(Number(choice.slice(7)))
    if (choice.startsWith('move:')) p.act(() => api.library.moveStyle(s.id, { familyId: Number(choice.slice(5)) }))
    if (choice === 'move-new')
      p.onPrompt({
        title: `Move “${s.styleName}” to a new family`,
        placeholder: 'Family name',
        initial: family.name,
        confirmLabel: 'Move',
        onSubmit: (name) =>
          p.act(async () => {
            const id = await api.library.moveStyle(s.id, { newName: name })
            p.onOpenFamily(id)
          })
      })
  }

  return (
    <div className="family-page">
      <header className="toolbar">
        <button className="back-button" onClick={p.onBack}>
          <span aria-hidden="true">‹</span> Library
        </button>
        <div className="toolbar-title">{family.name}</div>
        <div className="toolbar-size">
          <input
            type="range"
            min={12}
            max={240}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="Preview size"
          />
          <span className="toolbar-size-value">{size} pt</span>
        </div>
        <button className="icon-button" onClick={p.onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {p.theme === 'light' ? '◐' : '◑'}
        </button>
        <button
          className={'bar-button' + (p.panelOpen ? ' is-active' : '')}
          onClick={p.onTogglePanel}
          aria-pressed={p.panelOpen}
        >
          Details
        </button>
      </header>

      {(family.styles.length > 1 || style.axes.length > 0) && (
        <div className="style-bar">
          <div className="style-bar-main">
          {family.styles.length > 1 && (
            <select
              className="field style-select"
              value={style.id}
              onChange={(e) => setStyleId(Number(e.target.value))}
              aria-label="Style"
            >
              {groups.map((g) =>
                grouped ? (
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
            <button
              className={'bar-button default-button' + (isDefault ? ' is-default' : '')}
              onClick={saveDefault}
              disabled={isDefault}
              title="Use this style (and these axis values) in the library grid and when this page opens"
            >
              {isDefault ? '✓ Default' : 'Set as Default'}
            </button>
          </div>
          {style.axes.length > 0 && (
          <div className="style-bar-axes">
          {style.axes.map((a) => (
            <label key={a.tag} className="axis" title="Double-click to reset">
              <span className="axis-head">
                <span>{a.name || a.tag}</span>
                <span className="axis-value">{Math.round((axes[a.tag] ?? a.default) * 10) / 10}</span>
              </span>
              <input
                type="range"
                min={a.min}
                max={a.max}
                step={a.max - a.min > 20 ? 1 : 0.1}
                value={axes[a.tag] ?? a.default}
                onChange={(e) => setAxes({ ...axes, [a.tag]: Number(e.target.value) })}
                onDoubleClick={() => setAxes({ ...axes, [a.tag]: a.default })}
                aria-label={a.name || a.tag}
              />
            </label>
          ))}
          </div>
          )}
        </div>
      )}

      <div className="family-body">
        <div className="family-main">
          <section className="hero">
            <Specimen
              key={`${style.id}`}
              className="hero-specimen"
              style={style}
              text={text}
              size={size}
              variation={variation}
              features={featureCss}
              wrap
              editable
              onEdit={(t) => setText(t.trim() || SAMPLE)}
            />
            <div className="hero-caption">
              {styleLabel(style)} · {style.weight}
              {style.italic ? ' · Italic' : ''} · Click the text to edit it
            </div>
          </section>

          <section className="style-list">
            <div className="style-list-heading">
              <div className="segmented" role="tablist">
                <button className={tab === 'styles' ? 'is-active' : ''} onClick={() => setTab('styles')}>
                  {family.styles.length} {family.styles.length === 1 ? 'Style' : 'Styles'}
                </button>
                <button className={tab === 'glyphs' ? 'is-active' : ''} onClick={() => setTab('glyphs')}>
                  Glyphs
                </button>
              </div>
              {tab === 'glyphs' && <span className="cell-sub">{style.styleName}</span>}
            </div>
            {tab === 'glyphs' && <GlyphMap style={style} variation={variation} features={featureCss} />}
            {tab === 'styles' && groups.map((g) => (
              <div key={g.name} className={grouped ? 'style-group' : undefined}>
                {grouped && (
                  <div className="style-group-heading">
                    <span>{g.name}</span>
                    <span className="cell-sub">
                      {g.styles.length} {g.styles.length === 1 ? 'style' : 'styles'}
                    </span>
                  </div>
                )}
            {g.styles.map((s) => (
              <article
                key={s.id}
                className={'style-row' + (s.id === style.id ? ' is-current' : '')}
                onClick={() => setStyleId(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  styleMenu(s)
                }}
              >
                <div className="style-meta">
                  <div className="cell-name">
                    {s.styleName}
                    {family.hasSavedDefault && s.id === family.defaultStyleId && (
                      <span className="mark style-default-mark">Default</span>
                    )}
                  </div>
                  <div className="cell-sub">
                    {s.isVariable
                      ? `Variable · ${s.axes.map((a) => a.tag).join(' ')}`
                      : `${s.weight}${s.italic ? ' · Italic' : ''}`}
                  </div>
                  <div className="cell-sub style-ps">{s.postscriptName}</div>
                </div>
                <Specimen
                  className="style-specimen"
                  style={s}
                  text={text}
                  size={Math.min(size, 40)}
                  variation={s.id === family.defaultStyleId ? variationCss(family.defaultVariation) : undefined}
                />
                <button
                  className="cell-action"
                  aria-label={`Actions for ${s.styleName}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    styleMenu(s)
                  }}
                >
                  •••
                </button>
              </article>
            ))}
              </div>
            ))}
          </section>
        </div>

        {p.panelOpen && (
        <aside className="family-panel">
          {featureList.length > 0 && (
            <section className="panel-section">
              <button
                className="panel-heading panel-disclosure"
                onClick={() => setFeaturesOpen(!featuresOpen)}
                aria-expanded={featuresOpen}
              >
                <span>
                  <span className={'disclosure' + (featuresOpen ? ' is-open' : '')} aria-hidden="true">
                    ›
                  </span>
                  OpenType Features
                </span>
                <span className="panel-count">
                  {changedFeatures > 0 ? `${changedFeatures} changed` : featureList.length}
                </span>
              </button>
              {featuresOpen && (
                <div className="features">
                  {featureList.map((tag) => (
                    <button
                      key={tag}
                      className={'feature' + (featureState[tag] ? ' is-on' : '')}
                      aria-pressed={!!featureState[tag]}
                      onClick={() => setFeatureState((cur) => ({ ...cur, [tag]: !cur[tag] }))}
                      title={tag}
                    >
                      {featureName(tag)}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          <Section title="Details">
            <Row label="Name">
              <InlineField value={family.name} placeholder="Family name" onSave={(v) => v && save({ name: v })} />
            </Row>
            <Row label="Designer">
              <InlineField value={family.designer} placeholder="Unknown" onSave={(v) => save({ designer: v })} />
            </Row>
            <Row label="Foundry">
              <InlineField value={family.foundry} placeholder="Unknown" onSave={(v) => save({ foundry: v })} />
            </Row>
            <Row label="Category">
              <button className="value-button" onClick={() => p.onCategoryMenu(family.id, family.category)}>
                {family.category ?? <span className="muted">None</span>}
              </button>
            </Row>
            <Row label="Tags">
              <button className="value-button" onClick={() => p.onEditTags(family.id)}>
                {family.tags.length ? family.tags.join(', ') : <span className="muted">Add tags</span>}
              </button>
            </Row>
          </Section>

          <Section
            title="Sources"
            action={
              <button
                className="panel-action"
                onClick={() =>
                  p.onPrompt({
                    title: 'Add Source Link',
                    label: 'Paste a Google Fonts specimen link or a GitHub repository link.',
                    placeholder: 'https://fonts.google.com/specimen/… or https://github.com/…',
                    confirmLabel: 'Add Link',
                    onSubmit: (url) => p.act(() => api.library.addSourceLink(family.id, url))
                  })
                }
              >
                Add Link…
              </button>
            }
          >
            {family.sources.map((s) => (
              <div key={s.id} className="source">
                <div className="source-head">
                  <span className="mark">{SOURCE_LABEL[s.type]}</span>
                  <span className="source-name">{SOURCE_NAME[s.type]}</span>
                  {s.isReference && (
                    <button
                      className="link-button source-remove"
                      onClick={() => p.act(() => api.library.removeSourceLink(s.id))}
                      title="Remove link"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {s.url && (
                  <a className="source-url" href={s.url} target="_blank" rel="noreferrer">
                    {s.url.replace(/^https:\/\//, '')}
                  </a>
                )}
                {(s.ref || s.version) && (
                  <div className="cell-sub">{[s.ref, s.version].filter(Boolean).join(' · ')}</div>
                )}
                {s.isReference && <div className="cell-sub">Reference link</div>}
              </div>
            ))}
          </Section>

          <Section title="License">
            <InlineField
              value={family.license}
              placeholder="No license text"
              multiline
              onSave={(v) => save({ license: v })}
            />
            <div className="panel-gap" />
            <InlineField value={family.licenseUrl} placeholder="License URL" onSave={(v) => save({ licenseUrl: v })} />
            {family.licenseUrl?.startsWith('http') && (
              <a className="source-url" href={family.licenseUrl} target="_blank" rel="noreferrer">
                Open license
              </a>
            )}
          </Section>

          <Section title="Notes">
            <InlineField value={family.notes} placeholder="Add notes" multiline onSave={(v) => save({ notes: v })} />
          </Section>

          <Section title="Info">
            {scripts.length > 0 && <Row label="Scripts">{scripts.join(', ')}</Row>}
            {glyphs > 0 && <Row label="Glyphs">{glyphs.toLocaleString()}</Row>}
            <Row label="Files">
              {family.styles.flatMap((s) => s.assets).length} ·{' '}
              {formatSize(
                [...new Map(family.styles.flatMap((s) => s.assets).map((a) => [a.path, a.size ?? 0])).values()].reduce(
                  (n, b) => n + b,
                  0
                )
              )}
            </Row>
            <Row label="Added">{new Date(family.createdAt).toLocaleDateString()}</Row>
          </Section>
        </aside>
        )}
      </div>
    </div>
  )
}
