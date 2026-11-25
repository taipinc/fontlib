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
  /** For styles with no local file (Google Fonts): where the browser loads the face from. */
  remote?: RemoteFace
  /** The style's files (system references) can no longer be found. */
  missing?: boolean
  /** Picker previews only: a fontlib:// URL to load the face from directly. */
  previewUrl?: string
}

/** Typesetting for one role (heading or body) in the playground. */
export interface RoleSettings {
  size: number
  lineHeight: number
  /** Letter-spacing in em. */
  tracking: number
  /** Axis values for variable styles. */
  variation?: Variation
}

export interface PairingSlot {
  familyId: number
  styleId: number | null
}

export interface Pairing {
  id: number
  name: string
  heading: PairingSlot
  body: PairingSlot
  settings: { heading?: RoleSettings; body?: RoleSettings }
  createdAt: string
  collectionIds: number[]
}

export interface PairingInput {
  /** Updates this pairing when set; creates a new one otherwise. */
  id?: number
  name: string
  heading: PairingSlot
  body: PairingSlot
  settings: { heading?: RoleSettings; body?: RoleSettings }
}

/** A saved Adobe Fonts web project (kit), read from its CSS link. */
export interface AdobeKit {
  id: number
  kitId: string
  url: string
  name: string
  syncedAt: string | null
  families: AdobeKitFamily[]
}

export interface AdobeKitFamily {
  /** The CSS font-family name to use in projects, e.g. "trade-gothic-next". */
  cssName: string
  displayName: string
  styleCount: number
  /** The library family it was added as, or null if not added yet. */
  familyId: number | null
}

/** The characters a font covers, for the glyph map. */
export interface GlyphInfo {
  codePoints: number[]
  /** Glyph name for each code point (same order), when the font provides one. */
  names: (string | null)[]
  /** Total glyphs in the font, including unencoded ones (alternates, ligatures). */
  glyphCount: number
}

/** An installed family, as listed by the system font picker (never persisted). */
export interface SystemFamily {
  name: string
  styleCount: number
  /** Face to preview, served at fontlib://system/<id>. */
  previewFaceId: number
  /** Every style is already in the library. */
  inLibrary: boolean
  /** Installed by the user (~/Library/Fonts or /Library/Fonts) rather than shipped with macOS. */
  userInstalled: boolean
}

/** A face loaded by the browser from a web font stylesheet (Google CSS2). */
export interface RemoteFace {
  cssUrl: string
  /** The CSS font-family name the stylesheet declares. */
  family: string
  weight: number
  italic: boolean
}

/** Axis values, by tag, for a variable font. */
export type Variation = Record<string, number>

export interface GooglePreview {
  family: string
  designer: string | null
  category: string | null
  license: string | null
  styleCount: number
  axes: string[]
  cssUrl: string
  /** Set when a family with this name is already in the library (the Google source attaches to it). */
  existingFamilyId: number | null
}

export interface GitHubFile {
  /** Opaque id passed back to import: rel:<asset>, zip:<asset>:<entry> or tree:<path>. */
  id: string
  path: string
  name: string
  size: number
  /** Folder (or "release zip / folder") the file is listed under. */
  group: string
}

export interface GitHubPreview {
  url: string
  owner: string
  repo: string
  description: string | null
  license: string | null
  licenseUrl: string | null
  defaultBranch: string
  commit: string
  release: { tag: string; name: string; url: string } | null
  /** Fonts attached to the latest release, including those inside release zips. */
  releaseFiles: GitHubFile[]
  /** Fonts on the default branch. */
  branchFiles: GitHubFile[]
  /** GitHub cut the file listing short (very large repo). */
  truncated: boolean
  /** Release archives that were too large or unreadable to list. */
  skippedArchives: string[]
}

export interface GitHubImportResult extends ImportResult {
  familyIds: number[]
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
  /** The style used for previews: the one the user saved, else the closest to Regular. */
  defaultStyleId: number | null
  /** Saved axis values for the default style (variable fonts), or null. */
  defaultVariation: Variation | null
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
  /** Adobe and Google: the CSS font-family name the web stylesheet declares. */
  cssName?: string
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
  defaultVariation: Variation | null
  /** True when the user saved the default (rather than it being picked automatically). */
  hasSavedDefault: boolean
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

export interface CollectionSummary {
  id: number
  name: string
  /** Families in the collection, in collection order. */
  familyIds: number[]
  /** Saved pairings in the collection. */
  pairingIds: number[]
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
    /** The style's character map, or null when it has no local file (e.g. Google Fonts). */
    glyphs(styleId: number): Promise<GlyphInfo | null>
    /** Subscribes to library changes made outside the renderer (e.g. relocated system fonts). */
    onChanged(listener: () => void): () => void
    updateFamily(familyId: number, patch: FamilyPatch): Promise<void>
    /** Attaches a Google Fonts or GitHub URL to a family as a reference source. */
    addSourceLink(familyId: number, url: string): Promise<void>
    /** Removes a reference source (sources that supplied files cannot be removed). */
    removeSourceLink(sourceId: number): Promise<void>
    /** Moves a style into another family (by id) or into a new family (by name). Returns the target family id. */
    moveStyle(styleId: number, target: { familyId: number } | { newName: string }): Promise<number>
    revealAsset(assetId: number): Promise<void>
    /** Saves the style (and axis values, for variable fonts) used for this family's previews. */
    setDefaultStyle(familyId: number, styleId: number, variation: Variation | null): Promise<void>
  }
  organize: {
    tags(): Promise<TagSummary[]>
    setFamilyTags(familyId: number, tags: string[]): Promise<void>
    setCategory(familyIds: number[], category: string | null): Promise<void>
    renameCategory(from: string, to: string | null): Promise<void>
    collections(): Promise<CollectionSummary[]>
    createCollection(name: string): Promise<number>
    renameCollection(id: number, name: string): Promise<void>
    /** Asks for confirmation, then deletes the collection (not its fonts). */
    deleteCollection(id: number): Promise<boolean>
    addToCollection(id: number, familyIds: number[]): Promise<void>
    removeFromCollection(id: number, familyIds: number[]): Promise<void>
    addTags(familyIds: number[], tags: string[]): Promise<void>
    /** Renames a tag everywhere (merging into an existing tag of that name). */
    renameTag(from: string, to: string): Promise<void>
    /** Asks for confirmation, then removes the tag from every family. */
    deleteTag(name: string): Promise<boolean>
    /** Asks for confirmation, then removes the families. Resolves true if removed. */
    removeFamilies(familyIds: number[]): Promise<boolean>
    /** Merges families into targetId; newName (if given) renames the result. */
    merge(familyIds: number[], targetId: number, newName: string | null): Promise<void>
  }
  google: {
    /** Reads a family's metadata from the google/fonts repo, for the Add dialog's preview. */
    lookup(url: string): Promise<GooglePreview>
    /** Adds the family (or attaches it to an existing one). Resolves with the family id. */
    add(url: string): Promise<number>
  }
  pairings: {
    list(): Promise<Pairing[]>
    save(pairing: PairingInput): Promise<number>
    /** Asks for confirmation, then deletes the pairing (not its fonts). */
    remove(id: number): Promise<boolean>
    addToCollection(collectionId: number, pairingId: number): Promise<void>
    removeFromCollection(collectionId: number, pairingId: number): Promise<void>
  }
  adobe: {
    kits(): Promise<AdobeKit[]>
    /** Reads a kit link (saved or not) and lists its families. */
    preview(url: string): Promise<AdobeKit>
    /** Saves the kit if new and adds the chosen families (by CSS name). */
    add(url: string, cssNames: string[]): Promise<GitHubImportResult>
    /** Re-reads a saved kit and updates the families added from it. */
    sync(id: number): Promise<GitHubImportResult>
    rename(id: number, name: string): Promise<void>
    /** Asks for confirmation, then forgets the kit and its link-only families. */
    remove(id: number): Promise<boolean>
  }
  system: {
    /** Scans installed fonts (cached for the session) and lists their families. */
    list(): Promise<SystemFamily[]>
    /** Adds installed families to the library by reference (path and PostScript name). */
    add(names: string[]): Promise<GitHubImportResult>
  }
  github: {
    /** Lists font files in the repo's latest release and default branch. */
    lookup(url: string): Promise<GitHubPreview>
    /** Downloads the chosen files (by GitHubFile id) and imports them. */
    import(url: string, fileIds: string[]): Promise<GitHubImportResult>
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
  setDefaultStyle: 'library:set-default-style',
  googleLookup: 'google:lookup',
  googleAdd: 'google:add',
  githubLookup: 'github:lookup',
  systemList: 'system:list',
  adobeKits: 'adobe:kits',
  pairingsList: 'pairings:list',
  pairingsSave: 'pairings:save',
  pairingsRemove: 'pairings:remove',
  pairingsAddToCollection: 'pairings:add-to-collection',
  pairingsRemoveFromCollection: 'pairings:remove-from-collection',
  adobePreview: 'adobe:preview',
  adobeAdd: 'adobe:add',
  adobeSync: 'adobe:sync',
  adobeRename: 'adobe:rename',
  adobeRemove: 'adobe:remove',
  glyphs: 'library:glyphs',
  systemAdd: 'system:add',
  libraryChanged: 'library:changed',
  githubImport: 'github:import',
  tags: 'organize:tags',
  setFamilyTags: 'organize:set-family-tags',
  setCategory: 'organize:set-category',
  renameCategory: 'organize:rename-category',
  collections: 'organize:collections',
  createCollection: 'organize:create-collection',
  renameCollection: 'organize:rename-collection',
  deleteCollection: 'organize:delete-collection',
  addToCollection: 'organize:add-to-collection',
  removeFromCollection: 'organize:remove-from-collection',
  addTags: 'organize:add-tags',
  renameTag: 'organize:rename-tag',
  deleteTag: 'organize:delete-tag',
  removeFamilies: 'organize:remove-families',
  merge: 'organize:merge',
  contextMenu: 'ui:context-menu',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const
