// The typed contract between renderer and main. Every IPC channel is declared here.

export type SourceType = 'google' | 'adobe' | 'github' | 'file' | 'system'

export interface AppInfo {
  name: string
  version: string
  libraryPath: string
}

export interface Axis {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

/** A style as the renderer needs it for previews. */
export interface StyleSummary {
  id: number
  postscriptName: string
  styleName: string
  weight: number
  italic: boolean
  width: number
  isVariable: boolean
  axes: Axis[]
  /** Asset id served at fontlib://asset/<id>, or null if no loadable file. */
  assetId: number | null
}

export interface FamilySummary {
  id: number
  name: string
  designer: string | null
  foundry: string | null
  category: string | null
  sources: SourceType[]
  isVariable: boolean
  styles: StyleSummary[]
  /** The style used for previews by default (closest to Regular). */
  defaultStyleId: number | null
  createdAt: string
}

export interface ImportResult {
  familiesAdded: number
  familiesUpdated: number
  stylesAdded: number
  skippedDuplicates: number
  errors: { file: string; message: string }[]
}

export type Settings = Partial<{
  theme: 'light' | 'dark'
  previewText: string
  previewSize: number
  layout: 'grid' | 'rows'
}>

export interface FontLibApi {
  app: {
    info(): Promise<AppInfo>
  }
  library: {
    families(): Promise<FamilySummary[]>
    /** Opens the native picker (files, folders, zips) and imports the selection. Null if cancelled. */
    importWithPicker(): Promise<ImportResult | null>
    /** Imports files dropped onto the window. */
    importFiles(files: File[]): Promise<ImportResult>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Settings): Promise<void>
  }
}

export const IPC = {
  appInfo: 'app:info',
  families: 'library:families',
  importWithPicker: 'library:import-picker',
  importPaths: 'library:import-paths',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const
