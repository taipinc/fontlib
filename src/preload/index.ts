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
      )
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  }
}

contextBridge.exposeInMainWorld('fontlib', api)
