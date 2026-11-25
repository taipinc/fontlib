import { useEffect, useState } from 'react'
import type { AdobeKit } from '@shared/api'

const api = window.fontlib

function ago(iso: string | null): string {
  if (!iso) return 'never synced'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'synced just now'
  if (mins < 60) return `synced ${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `synced ${hours} h ago`
  return `synced ${new Date(iso).toLocaleDateString()}`
}

interface Props {
  /** Bumps when the library changes, so counts stay current. */
  revision: number
  act(task: () => Promise<unknown>): Promise<void>
  onStatus(text: string): void
  onAddKit(): void
  onAddFamilies(kitUrl: string): void
  onRename(kit: AdobeKit): void
}

/** Every saved Adobe web project (kit) in one list, with sync and management actions. */
export function AdobeKits(p: Props) {
  const [kits, setKits] = useState<AdobeKit[] | null>(null)
  const [syncing, setSyncing] = useState<number | null>(null)

  useEffect(() => {
    api.adobe.kits().then(setKits)
  }, [p.revision])

  const sync = (kit: AdobeKit): Promise<void> =>
    p.act(async () => {
      setSyncing(kit.id)
      try {
        const r = await api.adobe.sync(kit.id)
        const fresh = (await api.adobe.kits()).find((k) => k.id === kit.id)
        const pending = fresh ? fresh.families.filter((f) => f.familyId === null).length : 0
        p.onStatus(
          `${kit.name}: synced${r.stylesAdded ? `, ${r.stylesAdded} new styles` : ''}${pending ? ` · ${pending} families not added yet` : ''}`
        )
      } finally {
        setSyncing(null)
      }
    })

  const menu = async (kit: AdobeKit): Promise<void> => {
    const choice = await api.ui.contextMenu([
      { id: 'rename', label: 'Rename…' },
      { id: 'copy', label: 'Copy Link' },
      { type: 'separator' },
      { id: 'remove', label: 'Remove Kit…' }
    ])
    if (choice === 'rename') p.onRename(kit)
    if (choice === 'copy') navigator.clipboard.writeText(kit.url).then(() => p.onStatus('Kit link copied'))
    if (choice === 'remove') p.act(() => api.adobe.remove(kit.id))
  }

  if (kits === null) return null

  return (
    <section className="kits">
      <div className="kits-head">
        <span>Adobe Fonts web projects</span>
        <button className="panel-action" onClick={p.onAddKit}>
          Add Kit…
        </button>
      </div>
      {kits.length === 0 && (
        <div className="kits-empty">
          Paste a web project link (use.typekit.net/….css) in Add Fonts. After changing the project on
          fonts.adobe.com, sync it here.
        </div>
      )}
      {kits.map((kit) => {
        const added = kit.families.filter((f) => f.familyId !== null).length
        const pending = kit.families.length - added
        return (
          <div key={kit.id} className="kit" onContextMenu={(e) => (e.preventDefault(), menu(kit))}>
            <div className="kit-main">
              <div className="kit-name">{kit.name}</div>
              <a className="kit-url" href={kit.url} target="_blank" rel="noreferrer">
                {kit.url.replace(/^https:\/\//, '')}
              </a>
            </div>
            <div className="kit-facts cell-sub">
              {added} of {kit.families.length} {kit.families.length === 1 ? 'family' : 'families'} in library ·{' '}
              {ago(kit.syncedAt)}
            </div>
            <div className="kit-actions">
              {pending > 0 && (
                <button className="bar-button" onClick={() => p.onAddFamilies(kit.url)}>
                  Add {pending} More…
                </button>
              )}
              <button className="bar-button" disabled={syncing === kit.id} onClick={() => sync(kit)}>
                {syncing === kit.id ? 'Syncing…' : 'Sync'}
              </button>
              <button className="cell-action kit-more" aria-label={`More for ${kit.name}`} onClick={() => menu(kit)}>
                •••
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
