import { useState } from 'react'
import { Sidebar, type View } from './components/Sidebar'
import { Toolbar, type Layout } from './components/Toolbar'
import { useTheme } from './theme'

export function App() {
  const [theme, toggleTheme] = useTheme()
  const [view, setView] = useState<View>({ kind: 'all' })
  const [layout, setLayout] = useState<Layout>('grid')
  const [search, setSearch] = useState('')
  const [previewText, setPreviewText] = useState('Aa 123')
  const [size, setSize] = useState(72)

  return (
    <div className="app">
      <Sidebar view={view} onSelect={setView} />
      <main className="main">
        <Toolbar
          count={0}
          search={search}
          onSearch={setSearch}
          layout={layout}
          onLayout={setLayout}
          previewText={previewText}
          onPreviewText={setPreviewText}
          size={size}
          onSize={setSize}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <section className="content">
          <div className="empty">
            <p className="empty-title">Your library is empty</p>
            <p className="empty-body">Add fonts from files, Google Fonts, Adobe Fonts, GitHub or your system.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
