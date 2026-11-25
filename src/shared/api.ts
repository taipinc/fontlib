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
  tags: string[]
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

export interface TagSummary {
  id: number
  name: string
  count: number
}

export type CollectionKind = 'plain' | 'project'

export interface CollectionSummary {
  id: number
  name: string
  kind: CollectionKind
  /** Families in the collection, in collection order. */
  familyIds: number[]
}

/** A native context menu, described from the renderer and shown by main. */
export interface MenuItem {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'checkbox'
  checked?: boolean
  enabled?: boolean
  submenu?: MenuItem[]
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
    /** Asks for confirmation, then removes the family. Resolves true if removed. */
    removeFamily(familyId: number): Promise<boolean>
    revealFamily(familyId: number): Promise<void>
  }
  organize: {
    tags(): Promise<TagSummary[]>
    setFamilyTags(familyId: number, tags: string[]): Promise<void>
    setCategory(familyIds: number[], category: string | null): Promise<void>
    renameCategory(from: string, to: string | null): Promise<void>
    collections(): Promise<CollectionSummary[]>
    createCollection(name: string, kind: CollectionKind): Promise<number>
    renameCollection(id: number, name: string): Promise<void>
    setCollectionKind(id: number, kind: CollectionKind): Promise<void>
    /** Asks for confirmation, then deletes the collection (not its fonts). */
    deleteCollection(id: number): Promise<boolean>
    addToCollection(id: number, familyIds: number[]): Promise<void>
    removeFromCollection(id: number, familyIds: number[]): Promise<void>
    addTags(familyIds: number[], tags: string[]): Promise<void>
    /** Asks for confirmation, then removes the families. Resolves true if removed. */
    removeFamilies(familyIds: number[]): Promise<boolean>
    /** Merges families into targetId; newName (if given) renames the result. */
    merge(familyIds: number[], targetId: number, newName: string | null): Promise<void>
  }
  ui: {
    /** Shows a native context menu at the cursor; resolves with the chosen item id, or null. */
    contextMenu(items: MenuItem[]): Promise<string | null>
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
  removeFamily: 'library:remove-family',
  revealFamily: 'library:reveal-family',
  tags: 'organize:tags',
  setFamilyTags: 'organize:set-family-tags',
  setCategory: 'organize:set-category',
  renameCategory: 'organize:rename-category',
  collections: 'organize:collections',
  createCollection: 'organize:create-collection',
  renameCollection: 'organize:rename-collection',
  setCollectionKind: 'organize:set-collection-kind',
  deleteCollection: 'organize:delete-collection',
  addToCollection: 'organize:add-to-collection',
  removeFromCollection: 'organize:remove-from-collection',
  addTags: 'organize:add-tags',
  removeFamilies: 'organize:remove-families',
  merge: 'organize:merge',
  contextMenu: 'ui:context-menu',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const
