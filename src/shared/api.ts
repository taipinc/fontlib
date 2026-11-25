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
  /** The family name the font file itself declares; differs from the family after a merge. */
  originFamily?: string
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

export interface SourceDetail {
  id: number
  type: SourceType
  url: string | null
  repoUrl: string | null
  ref: string | null
  version: string | null
  /** True for a link added by hand to a family imported from files: no files come from it. */
  isReference: boolean
}

export interface AssetDetail {
  id: number
  kind: string
  storage: 'stored' | 'system-path' | 'remote'
  /** Display path (relative to the library for stored files). */
  path: string
  size: number | null
  sourceType: SourceType
  missing: boolean
}

export interface StyleDetail extends StyleSummary {
  fullName: string | null
  features: string[]
  scripts: string[]
  glyphCount: number | null
  version: string | null
  assets: AssetDetail[]
}

export interface FamilyDetail {
  id: number
  name: string
  designer: string | null
  foundry: string | null
  category: string | null
  notes: string | null
  license: string | null
  licenseUrl: string | null
  tags: string[]
  sources: SourceDetail[]
  styles: StyleDetail[]
  defaultStyleId: number | null
  createdAt: string
  updatedAt: string
}

export type FamilyPatch = Partial<{
  name: string
  designer: string | null
  foundry: string | null
  notes: string | null
  license: string | null
  licenseUrl: string | null
}>

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
  /** Whether the family page's details panel is shown. */
  familyPanel: boolean
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
    family(familyId: number): Promise<FamilyDetail | null>
    updateFamily(familyId: number, patch: FamilyPatch): Promise<void>
    /** Attaches a Google Fonts or GitHub URL to a family as a reference source. */
    addSourceLink(familyId: number, url: string): Promise<void>
    /** Removes a reference source (sources that supplied files cannot be removed). */
    removeSourceLink(sourceId: number): Promise<void>
    /** Moves a style into another family (by id) or into a new family (by name). Returns the target family id. */
    moveStyle(styleId: number, target: { familyId: number } | { newName: string }): Promise<number>
    revealAsset(assetId: number): Promise<void>
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
  family: 'library:family',
  updateFamily: 'library:update-family',
  addSourceLink: 'library:add-source-link',
  removeSourceLink: 'library:remove-source-link',
  moveStyle: 'library:move-style',
  revealAsset: 'library:reveal-asset',
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
