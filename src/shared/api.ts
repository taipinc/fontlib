// The typed contract between renderer and main. Every IPC channel is declared here.

export interface AppInfo {
  name: string
  version: string
  libraryPath: string
}

export interface FontLibApi {
  app: {
    info(): Promise<AppInfo>
  }
}

export const IPC = {
  appInfo: 'app:info'
} as const
