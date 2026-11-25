import type { CSSProperties } from 'react'
import type { StyleSummary } from '@shared/api'
import { useFace } from '../fonts'

interface Props {
  style: StyleSummary | undefined
  text: string
  size: number
  className?: string
  /** CSS font-variation-settings (variable axes). */
  variation?: string
  /** CSS font-feature-settings (OpenType toggles). */
  features?: string
  /** Allow wrapping onto several lines (default: single line, clipped). */
  wrap?: boolean
  /** Lets the user edit the text in place. */
  editable?: boolean
  onEdit?(text: string): void
}

/** Text set in a library font. Invisible until the face is loaded; never shows a fallback font. */
export function Specimen({ style, text, size, className, variation, features, wrap, editable, onEdit }: Props) {
  const face = useFace(style)

  if (face.status === 'error' || face.status === 'offline') {
    return (
      <div className={'specimen specimen-unavailable ' + (className ?? '')}>
        {face.status === 'offline' ? 'Offline' : 'Preview unavailable'}
      </div>
    )
  }

  const ready = face.status === 'ready'
  const css: CSSProperties = {
    fontFamily: ready ? `"${face.family}"` : undefined,
    fontWeight: ready && face.weight ? face.weight : undefined,
    fontStyle: ready && face.italic ? 'italic' : undefined,
    fontSize: `${size}px`,
    visibility: ready ? 'visible' : 'hidden',
    fontVariationSettings: variation,
    fontFeatureSettings: features
  }

  return (
    <div
      className={'specimen ' + (wrap ? 'specimen-wrap ' : '') + (className ?? '')}
      style={css}
      contentEditable={editable ? 'plaintext-only' : undefined}
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={editable ? (e) => onEdit?.(e.currentTarget.textContent ?? '') : undefined}
    >
      {text}
    </div>
  )
}
