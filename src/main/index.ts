import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type AppInfo, type Settings } from '@shared/api'
import { getDb } from './db'
import { importPaths } from './importer'
import { getSettings, listFamilies, setSettings } from './library'
import { libraryPath } from './paths'
import { handleProtocol, registerSchemePrivileges } from './protocol'

app.setName('FontLib')
registerSchemePrivileges()

function createWindow(): void {
  const dark = getSettings().theme === 'dark'
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 540,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: dark ? '#1c1c1e' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Never open new windows inside the app; external links go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  // Blocks navigation, including the default "open dropped file" behaviour.
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(
    IPC.appInfo,
    (): AppInfo => ({ name: app.getName(), version: app.getVersion(), libraryPath: libraryPath() })
  )

  ipcMain.handle(IPC.families, () => listFamilies())

  ipcMain.handle(IPC.importWithPicker, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Add Fonts',
      buttonLabel: 'Add',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Fonts and archives', extensions: ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2', 'zip'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return null
    return importPaths(res.filePaths)
  })

  ipcMain.handle(IPC.importPaths, (_event, paths: unknown) => {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string' && p.startsWith('/'))) {
      throw new Error('Invalid paths')
    }
    return importPaths(paths)
  })

  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_event, patch: Settings) => setSettings(patch ?? {}))
}

app.whenReady().then(() => {
  getDb()
  handleProtocol()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
