import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type FontLibApi } from '@shared/api'

const api: FontLibApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  library: {
    families: () => ipcRenderer.invoke(IPC.families),
    importWithPicker: () => ipcRenderer.invoke(IPC.importWithPicker),
    importFiles: (files) =>
      ipcRenderer.invoke(
        IPC.importPaths,
        files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)
      ),
    removeFamily: (id) => ipcRenderer.invoke(IPC.removeFamily, id),
    revealFamily: (id) => ipcRenderer.invoke(IPC.revealFamily, id),
    family: (id) => ipcRenderer.invoke(IPC.family, id),
    glyphs: (id) => ipcRenderer.invoke(IPC.glyphs, id),
    onChanged: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC.libraryChanged, handler)
      return () => ipcRenderer.removeListener(IPC.libraryChanged, handler)
    },
    updateFamily: (id, patch) => ipcRenderer.invoke(IPC.updateFamily, id, patch),
    addSourceLink: (id, url) => ipcRenderer.invoke(IPC.addSourceLink, id, url),
    removeSourceLink: (id) => ipcRenderer.invoke(IPC.removeSourceLink, id),
    moveStyle: (id, target) => ipcRenderer.invoke(IPC.moveStyle, id, target),
    revealAsset: (id) => ipcRenderer.invoke(IPC.revealAsset, id),
    setDefaultStyle: (familyId, styleId, variation) =>
      ipcRenderer.invoke(IPC.setDefaultStyle, familyId, styleId, variation)
  },
  adobe: {
    kits: () => ipcRenderer.invoke(IPC.adobeKits),
    preview: (url) => ipcRenderer.invoke(IPC.adobePreview, url),
    add: (url, names) => ipcRenderer.invoke(IPC.adobeAdd, url, names),
    sync: (id) => ipcRenderer.invoke(IPC.adobeSync, id),
    rename: (id, name) => ipcRenderer.invoke(IPC.adobeRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.adobeRemove, id)
  },
  system: {
    list: () => ipcRenderer.invoke(IPC.systemList),
    add: (names) => ipcRenderer.invoke(IPC.systemAdd, names)
  },
  github: {
    lookup: (url) => ipcRenderer.invoke(IPC.githubLookup, url),
    import: (url, ids) => ipcRenderer.invoke(IPC.githubImport, url, ids)
  },
  google: {
    lookup: (url) => ipcRenderer.invoke(IPC.googleLookup, url),
    add: (url) => ipcRenderer.invoke(IPC.googleAdd, url)
  },
  organize: {
    tags: () => ipcRenderer.invoke(IPC.tags),
    setFamilyTags: (id, tags) => ipcRenderer.invoke(IPC.setFamilyTags, id, tags),
    setCategory: (ids, category) => ipcRenderer.invoke(IPC.setCategory, ids, category),
    renameCategory: (from, to) => ipcRenderer.invoke(IPC.renameCategory, from, to),
    collections: () => ipcRenderer.invoke(IPC.collections),
    createCollection: (name, kind) => ipcRenderer.invoke(IPC.createCollection, name, kind),
    renameCollection: (id, name) => ipcRenderer.invoke(IPC.renameCollection, id, name),
    setCollectionKind: (id, kind) => ipcRenderer.invoke(IPC.setCollectionKind, id, kind),
    deleteCollection: (id) => ipcRenderer.invoke(IPC.deleteCollection, id),
    addToCollection: (id, ids) => ipcRenderer.invoke(IPC.addToCollection, id, ids),
    removeFromCollection: (id, ids) => ipcRenderer.invoke(IPC.removeFromCollection, id, ids),
    addTags: (ids, tags) => ipcRenderer.invoke(IPC.addTags, ids, tags),
    renameTag: (from, to) => ipcRenderer.invoke(IPC.renameTag, from, to),
    deleteTag: (name) => ipcRenderer.invoke(IPC.deleteTag, name),
    removeFamilies: (ids) => ipcRenderer.invoke(IPC.removeFamilies, ids),
    merge: (ids, targetId, newName) => ipcRenderer.invoke(IPC.merge, ids, targetId, newName)
  },
  ui: {
    contextMenu: (items) => ipcRenderer.invoke(IPC.contextMenu, items)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  }
}

contextBridge.exposeInMainWorld('fontlib', api)
