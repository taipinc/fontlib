import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// The library folder holds library.db and fonts/. It is self-contained so it can be
// moved or synced later. Configurable location comes with the Settings UI.
export function libraryPath(): string {
  const dir = join(app.getPath('appData'), 'FontLib')
  mkdirSync(join(dir, 'fonts'), { recursive: true })
  return dir
}

export function fontsPath(): string {
  return join(libraryPath(), 'fonts')
}
