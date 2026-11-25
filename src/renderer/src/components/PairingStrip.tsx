import { useEffect, useState } from 'react'
import type { CollectionSummary, FamilySummary, Pairing, PairingSlot } from '@shared/api'
import { Specimen } from './Specimen'

const api = window.fontlib

interface Props {
  collection: CollectionSummary | undefined
  families: FamilySummary[]
  revision: number
  act(task: () => Promise<unknown>): Promise<void>
  onOpen(pairing: Pairing): void
}

function styleFor(families: FamilySummary[], slot: PairingSlot) {
  const f = families.find((x) => x.id === slot.familyId)
  return { family: f, style: f?.styles.find((s) => s.id === slot.styleId) ?? f?.styles.find((s) => s.id === f.defaultStyleId) }
}

/** Saved pairings in a collection, shown above its families. Click to open in the Playground. */
export function PairingStrip({ collection, families, revision, act, onOpen }: Props) {
  const [pairings, setPairings] = useState<Pairing[]>([])

  useEffect(() => {
    api.pairings.list().then(setPairings)
  }, [revision])

  if (!collection) return null
  const shown = collection.pairingIds.map((id) => pairings.find((p) => p.id === id)).filter((p): p is Pairing => !!p)

  if (shown.length === 0 && collection.familyIds.length === 0) {
    return (
      <div className="kits-empty pairing-empty">
        This collection is empty. Drag families onto it in the sidebar, use a family’s ••• menu, or add a saved pairing
        from the Playground.
      </div>
    )
  }
  if (shown.length === 0) return null

  const menu = async (p: Pairing): Promise<void> => {
    const choice = await api.ui.contextMenu([
      { id: 'open', label: 'Open in Playground' },
      { id: 'remove', label: `Remove from “${collection.name}”` }
    ])
    if (choice === 'open') onOpen(p)
    if (choice === 'remove') act(() => api.pairings.removeFromCollection(collection.id, p.id))
  }

  return (
    <section className="kits">
      <div className="kits-head">
        <span>Pairings</span>
      </div>
      {shown.map((p) => {
        const h = styleFor(families, p.heading)
        const b = styleFor(families, p.body)
        return (
          <div
            key={p.id}
            className="kit pairing-row"
            onClick={() => onOpen(p)}
            onContextMenu={(e) => (e.preventDefault(), menu(p))}
          >
            <div className="pairing-sample">
              <Specimen style={h.style} text={h.family?.name ?? 'Missing font'} size={26} />
              <Specimen style={b.style} text={`${b.family?.name ?? 'Missing font'}: the body text face`} size={14} />
            </div>
            <div className="kit-facts cell-sub">{p.name}</div>
            <button
              className="cell-action kit-more"
              aria-label={`More for ${p.name}`}
              onClick={(e) => (e.stopPropagation(), menu(p))}
            >
              •••
            </button>
          </div>
        )
      })}
    </section>
  )
}
