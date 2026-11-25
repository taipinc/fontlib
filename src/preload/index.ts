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
    updateFamily: (id, patch) => ipcRenderer.invoke(IPC.updateFamily, id, patch),
    addSourceLink: (id, url) => ipcRenderer.invoke(IPC.addSourceLink, id, url),
    removeSourceLink: (id) => ipcRenderer.invoke(IPC.removeSourceLink, id),
    moveStyle: (id, target) => ipcRenderer.invoke(IPC.moveStyle, id, target),
    revealAsset: (id) => ipcRenderer.invoke(IPC.revealAsset, id)
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
