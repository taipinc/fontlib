import type { FontLibApi } from '../shared/api'

declare global {
  interface Window {
    fontlib: FontLibApi
  }
}

export {}
