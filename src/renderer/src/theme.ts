import { useEffect } from 'react'

export type Theme = 'light' | 'dark'

export function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useApplyTheme(theme: Theme): void {
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
}
