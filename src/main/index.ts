import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { IPC, type AppInfo, type MenuItem, type Settings } from '@shared/api'
import { getDb } from './db'
import { importPaths } from './importer'
import { backfillOriginFamilies, getFamily, getGlyphs, getSettings, listFamilies, setSettings } from './library'
import { exportLibrary, importLibrary, readBackup } from './backup'
import * as pairings from './pairings'
import { addFromKit, listKits, previewKit, removeKit, renameKit, syncKit } from './adobe'
import { importGitHub, lookupGitHub } from './github'
import { addSystemFamilies, listSystemFamilies, verifySystemAssets } from './system'
import { addGoogleFamily, lookupGoogle } from './google'
import * as organize from './organize'
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

  win.once('ready-to-show', () => {
    win.show()
    // Check system font references in the background; tell the window if anything changed.
    verifySystemAssets().then(
      (changed) => changed && !win.isDestroyed() && win.webContents.send(IPC.libraryChanged),
      (e) => console.warn('System font check failed', e)
    )
  })

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

async function confirm(
  sender: Electron.WebContents,
  message: string,
  detail: string,
  action: string
): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(sender)
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    message,
    detail,
    buttons: [action, 'Cancel'],
    defaultId: 1,
    cancelId: 1
  }
  const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return res.response === 0
}

function familyName(id: number): string {
  return (getDb().prepare('SELECT name FROM families WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? 'this family'
}

function toMenuTemplate(items: MenuItem[], pick: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((item) => ({
    label: item.label,
    type: item.submenu ? 'submenu' : (item.type ?? 'normal'),
    checked: item.checked,
    enabled: item.enabled ?? true,
    submenu: item.submenu ? toMenuTemplate(item.submenu, pick) : undefined,
    click: item.id ? () => pick(item.id!) : undefined
  }))
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

  ipcMain.handle(IPC.removeFamily, async (event, id: number) => {
    const ok = await confirm(
      event.sender,
      `Remove “${familyName(id)}” from your library?`,
      'Its stored font files are deleted from the library folder. Fonts installed on your system are not affected.',
      'Remove'
    )
    if (ok) organize.removeFamily(id)
    return ok
  })
  ipcMain.handle(IPC.revealFamily, (_e, id: number) => {
    const path = organize.familyFilePath(id)
    if (path) shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC.family, (_e, id: number) => getFamily(id))
  ipcMain.handle(IPC.updateFamily, (_e, id: number, patch: unknown) => organize.updateFamily(id, patch))
  ipcMain.handle(IPC.addSourceLink, (_e, id: number, url: unknown) => organize.addSourceLink(id, url))
  ipcMain.handle(IPC.removeSourceLink, (_e, id: number) => organize.removeSourceLink(id))
  ipcMain.handle(IPC.moveStyle, (_e, id: number, target: unknown) => organize.moveStyle(id, target))
  ipcMain.handle(IPC.revealAsset, (_e, id: number) => {
    const path = organize.assetFilePath(id)
    if (path) shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC.setDefaultStyle, (_e, familyId: number, styleId: number, variation: unknown) =>
    organize.setDefaultStyle(familyId, styleId, variation)
  )
  ipcMain.handle(IPC.googleLookup, async (_e, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid link')
    return (await lookupGoogle(url)).preview
  })
  ipcMain.handle(IPC.googleAdd, async (_e, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid link')
    return (await addGoogleFamily(url)).familyId
  })

  ipcMain.handle(IPC.glyphs, (_e, id: number) => getGlyphs(id))
  ipcMain.handle(IPC.pairingsList, () => pairings.listPairings())
  ipcMain.handle(IPC.pairingsSave, (_e, p: unknown) => pairings.savePairing(p))
  ipcMain.handle(IPC.pairingsRemove, async (event, id: number) => {
    const ok = await confirm(event.sender, 'Delete this pairing?', 'The fonts stay in your library.', 'Delete')
    if (ok) pairings.deletePairing(id)
    return ok
  })
  ipcMain.handle(IPC.pairingsAddToCollection, (_e, cid: number, pid: number) => pairings.addPairingToCollection(cid, pid))
  ipcMain.handle(IPC.pairingsRemoveFromCollection, (_e, cid: number, pid: number) =>
    pairings.removePairingFromCollection(cid, pid)
  )
  ipcMain.handle(IPC.adobeKits, () => listKits())
  ipcMain.handle(IPC.adobePreview, (_e, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid link')
    return previewKit(url)
  })
  ipcMain.handle(IPC.adobeAdd, (_e, url: unknown, names: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid link')
    return addFromKit(url, names)
  })
  ipcMain.handle(IPC.adobeSync, (_e, id: number) => syncKit(id))
  ipcMain.handle(IPC.adobeRename, (_e, id: number, name: unknown) => renameKit(id, name))
  ipcMain.handle(IPC.adobeRemove, async (event, id: number) => {
    const ok = await confirm(
      event.sender,
      'Remove this Adobe kit?',
      'Families added only from this kit are removed from your library. Your Adobe Fonts project is not changed.',
      'Remove'
    )
    if (ok) removeKit(id)
    return ok
  })
  ipcMain.handle(IPC.systemList, () => listSystemFamilies())
  ipcMain.handle(IPC.systemAdd, (_e, names: unknown) => addSystemFamilies(names))
  ipcMain.handle(IPC.githubLookup, async (_e, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid link')
    return (await lookupGitHub(url)).preview
  })
  ipcMain.handle(IPC.githubImport, (_e, url: unknown, ids: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid link')
    return importGitHub(url, ids)
  })

  ipcMain.handle(IPC.tags, () => organize.listTags())
  ipcMain.handle(IPC.setFamilyTags, (_e, id: number, tags: unknown) => organize.setFamilyTags(id, tags))
  ipcMain.handle(IPC.setCategory, (_e, ids: unknown, category: unknown) => organize.setCategory(ids, category))
  ipcMain.handle(IPC.renameCategory, (_e, from: unknown, to: unknown) => organize.renameCategory(from, to))
  ipcMain.handle(IPC.collections, () => organize.listCollections())
  ipcMain.handle(IPC.createCollection, (_e, name: unknown, kind: unknown) => organize.createCollection(name, kind))
  ipcMain.handle(IPC.renameCollection, (_e, id: number, name: unknown) => organize.renameCollection(id, name))
  ipcMain.handle(IPC.setCollectionKind, (_e, id: number, kind: unknown) => organize.setCollectionKind(id, kind))
  ipcMain.handle(IPC.deleteCollection, async (event, id: number) => {
    const ok = await confirm(event.sender, 'Delete this collection?', 'The fonts in it stay in your library.', 'Delete')
    if (ok) organize.deleteCollection(id)
    return ok
  })
  ipcMain.handle(IPC.addToCollection, (_e, id: number, ids: unknown) => organize.addToCollection(id, ids))
  ipcMain.handle(IPC.removeFromCollection, (_e, id: number, ids: unknown) => organize.removeFromCollection(id, ids))

  ipcMain.handle(IPC.renameTag, (_e, from: unknown, to: unknown) => organize.renameTag(from, to))
  ipcMain.handle(IPC.deleteTag, async (event, name: unknown) => {
    const ok = await confirm(
      event.sender,
      `Delete the tag “${String(name)}”?`,
      'It is removed from every family. The fonts stay in your library.',
      'Delete'
    )
    if (ok) organize.deleteTag(name)
    return ok
  })
  ipcMain.handle(IPC.addTags, (_e, ids: unknown, tags: unknown) => organize.addTagsToFamilies(ids, tags))
  ipcMain.handle(IPC.removeFamilies, async (event, ids: number[]) => {
    if (!Array.isArray(ids) || ids.length === 0) return false
    const ok = await confirm(
      event.sender,
      ids.length === 1 ? `Remove “${familyName(ids[0])}” from your library?` : `Remove ${ids.length} families from your library?`,
      'Their stored font files are deleted from the library folder. Fonts installed on your system are not affected.',
      'Remove'
    )
    if (ok) organize.removeFamilies(ids)
    return ok
  })
  ipcMain.handle(IPC.merge, (_e, ids: unknown, targetId: number, newName: unknown) =>
    organize.mergeFamilies(ids, targetId, newName)
  )

  ipcMain.handle(
    IPC.contextMenu,
    (event, items: MenuItem[]) =>
      new Promise<string | null>((resolvePick) => {
        let picked: string | null = null
        const menu = Menu.buildFromTemplate(toMenuTemplate(items, (id) => (picked = id)))
        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
        // 'callback' fires on close; click handlers run before it.
        menu.popup({ window: win, callback: () => setTimeout(() => resolvePick(picked), 0) })
      })
  )

  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_event, patch: Settings) => setSettings(patch ?? {}))
}

async function exportLibraryFlow(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const pick = await dialog.showOpenDialog(win, {
    title: 'Export Library',
    message: 'Choose where to save the backup folder.',
    buttonLabel: 'Export Here',
    properties: ['openDirectory', 'createDirectory']
  })
  if (pick.canceled || !pick.filePaths[0]) return
  try {
    const r = exportLibrary(pick.filePaths[0])
    const res = await dialog.showMessageBox(win, {
      type: 'info',
      message: 'Library exported',
      detail: `${r.families} families and ${r.files} stored font files were saved to\n${r.path}`,
      buttons: ['Show in Finder', 'OK'],
      defaultId: 1
    })
    if (res.response === 0) shell.showItemInFolder(r.path)
  } catch (e) {
    dialog.showErrorBox('Export failed', (e as Error).message)
  }
}

async function importLibraryFlow(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const pick = await dialog.showOpenDialog(win, {
    title: 'Import Library',
    message: 'Choose a “FontLib Backup” folder.',
    buttonLabel: 'Import',
    properties: ['openDirectory']
  })
  if (pick.canceled || !pick.filePaths[0]) return
  try {
    const data = readBackup(pick.filePaths[0])
    const ok = await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Replace your library with this backup?',
      detail: `The backup holds ${data.tables.families?.length ?? 0} families (exported ${new Date(data.exportedAt).toLocaleString()}). Your current database is saved as a safety copy in the library folder first.`,
      buttons: ['Replace Library', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    if (ok.response !== 0) return
    const r = await importLibrary(pick.filePaths[0])
    await verifySystemAssets()
    win?.webContents.reload()
    dialog.showMessageBox(win, {
      type: 'info',
      message: 'Library restored',
      detail: `${r.families} families imported. The previous database was saved as ${r.safetyCopy.split('/').pop()}.`
    })
  } catch (e) {
    dialog.showErrorBox('Import failed', (e as Error).message)
  }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'Export Library…', click: () => void exportLibraryFlow() },
        { label: 'Import Library…', click: () => void importLibraryFlow() },
        { type: 'separator' },
        { label: 'Show Library Folder', click: () => void shell.openPath(libraryPath()) },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  getDb()
  backfillOriginFamilies()
  buildMenu()
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
