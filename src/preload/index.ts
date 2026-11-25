import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type FontLibApi } from '@shared/api'

const api: FontLibApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  }
}

contextBridge.exposeInMainWorld('fontlib', api)
