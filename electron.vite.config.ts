import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Strict CSP for the renderer. Remote styles/fonts are limited to Google and Adobe.
// In dev, Vite's HMR needs inline scripts and a websocket, so those are added only when serving.
function csp(): Plugin {
  let isServe = false
  return {
    name: 'fontlib-csp',
    configResolved(config) {
      isServe = config.command === 'serve'
    },
    transformIndexHtml(html) {
      const directives = [
        "default-src 'self'",
        `script-src 'self'${isServe ? " 'unsafe-inline'" : ''}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://use.typekit.net https://p.typekit.net",
        "font-src 'self' data: blob: fontlib: https://fonts.gstatic.com https://use.typekit.net https://p.typekit.net",
        "img-src 'self' data: blob:",
        `connect-src 'self'${isServe ? ' ws: http://localhost:*' : ''}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ].join('; ')
      return html.replace('%CSP%', directives)
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), csp()]
  }
})
