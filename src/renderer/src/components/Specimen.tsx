import type { StyleSummary } from '@shared/api'
import { useFace } from '../fonts'

interface Props {
  style: StyleSummary | undefined
  text: string
  size: number
  className?: string
}

/** Text set in a library font. Invisible until the face is loaded; never shows a fallback font. */
export function Specimen({ style, text, size, className }: Props) {
  const face = useFace(style?.assetId ?? null)

  if (face.status === 'error') {
    return <div className={'specimen specimen-unavailable ' + (className ?? '')}>Preview unavailable</div>
  }

  return (
    <div
      className={'specimen ' + (className ?? '')}
      style={{
        fontFamily: face.status === 'ready' ? `"${face.family}"` : undefined,
        fontSize: `${size}px`,
        visibility: face.status === 'ready' ? 'visible' : 'hidden'
      }}
    >
      {text}
    </div>
  )
}
