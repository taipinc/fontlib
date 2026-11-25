# Font Library App — Spec

Nov 25, 2026

## Overview

A personal macOS desktop app that holds only the fonts the user deliberately adds, from five sources (Google Fonts, Adobe Fonts, GitHub repos, local files, system fonts), keeps their metadata and source links, previews them beautifully, pairs them, and exports the right files or embed code for desktop and web projects.

**Principles**

- Intentional library: nothing is auto-imported and no catalog is browsed in bulk. Every entry is added by the user.
- Storage economy: Google fonts are online-only, system fonts are referenced by path, Adobe fonts are link-only. Only fonts from GitHub and local files are stored on disk.
- The UI recedes: neutral, minimal, hairline borders, system UI font, so specimens carry all visual weight.
- One "add" entry point that routes by source.

**Non-goals (v1)**

- Installing or activating fonts. The app exports files and the user installs them manually.
- Sync across machines (future; keep the library folder portable).
- Browsing the full Google or Adobe catalogs inside the app.
- Accounts, collaboration, Windows or Linux support.

## Stack and architecture

Electron with a Vite-built renderer, TypeScript throughout. Develop first as a plain Vite web app against local files, then wrap in Electron.

- **Renderer:** React or Svelte (agent's choice, stay consistent), plain CSS with custom properties for theming (light and dark). No heavy UI kit.
- **Main process:** owns filesystem, SQLite, network fetches (GitHub, Google repo, Adobe API), font parsing and woff2 conversion. The renderer talks to it only through a typed preload IPC bridge.
- **Storage:** SQLite (better-sqlite3) for metadata; a library folder for stored font files. Default `~/Library/Application Support/<app>/`, location configurable from the first version so syncing the folder later is trivial.
- **Font parsing:** fontkit for name table, axes, features, cmap coverage, license strings (name IDs 13 and 14), `.ttc` collections. No conversion toolchain: the app keeps the files the designer provided (see Export).
- **Security:** contextIsolation on, nodeIntegration off, strict CSP. Remote stylesheets and fonts allowed only from fonts.googleapis.com, fonts.gstatic.com, use.typekit.net and p.typekit.net, plus the GitHub CDN if used for previews.
- **Secrets:** the Adobe API token lives in the macOS keychain (Electron safeStorage), never in SQLite or plain config.
- **Distribution:** unsigned local build is fine (personal use). Mac only.

## Data model

A family is the unit users browse; styles hang under it; each family can have several sources (the same family may come from Google and GitHub).

| Entity | Key fields |
| --- | --- |
| Family | id, name, designer, foundry, category, notes, license (SPDX or free text), created and updated dates |
| Style | family, PostScript name, weight, italic, width, variable flag, axes (tag, min, default, max), OpenType features, script coverage (from cmap) |
| Source | family, type (google, adobe, github, file, system), url, repo URL, release tag or commit, version string, last checked date |
| Asset | style, kind (ttf, otf, woff2, variable), storage (stored, system-path, remote), path or URL, size |
| Tag | name; many-to-many with families |
| Collection | name, ordered families and pairings |
| Pairing | heading family and style, body family and style, per-role size, line-height, tracking, weight, name |
| Setting | library path, theme, last preview text, Adobe token reference |

**Rules**

- Identity and dedupe: match on family name plus PostScript names. If a new add matches an existing family, attach the new Source to it instead of creating a duplicate.
- Google entries store no files: only the family slug, the repo path used for metadata, and axes and weights needed to build the CSS URL.
- Adobe entries store kit ID, the family's CSS name and slug, and weights. No files, ever.
- System entries store path and PostScript name. On launch or open, verify the path; if missing, re-resolve by PostScript name, else mark the entry as missing (never delete it). Note macOS downloadable fonts live under versioned `/System/Library/AssetsV2/...` paths that change on updates.
- GitHub and file entries copy their files into the library folder (`fonts/<family-slug>/...`).

## Sources

All sources enter through one Add dialog. A paste field detects the source from the URL and routes it; separate entry points handle files, folders and the system picker.

| Source | Add by | Metadata from | Preview via | Stored locally |
| --- | --- | --- | --- | --- |
| Google Fonts | Pasting a fonts.google.com specimen URL or a css2 link | That family's METADATA in the google/fonts repo (no API key, no catalog) | Google CSS2 endpoint | Nothing |
| Adobe Fonts | Connecting an API token, then picking families from the user's web projects (kits) | Typekit API kit data (names, slugs, weights); rest manual | The kit CSS (use.typekit.net) | Nothing; kit ID and slugs only |
| GitHub | Pasting a repo URL; the app lists font files in the default branch and latest release and the user selects which to import | Font files themselves plus repo info (URL, tag or commit, license file) | Local copies | Selected files, copied into the library |
| Local files | Dropping or choosing files, folders or zips | Font files themselves | Local copies | Copies in the library |
| System fonts | A picker that lists installed fonts transiently (never persisted) | Font file at its path | The installed font, by path | Path and PostScript name only |

**Notes per source**

- **Google:** if the pasted link has no family, show a clear error. Export fetches TTFs from the repo at that moment and discards the temp copy afterwards.
- **Adobe:** sync lists the kit's families as "not yet in library" and the user picks which to import. Re-sync updates weights and slugs. **Spike first:** verify kit CSS loads from the Electron renderer origin; Adobe may enforce a domain allow-list. If it blocks, serve the UI from a localhost origin in the shell or add the origin to the kit's domains.
- **GitHub:** prefer release assets over raw tree files where both exist; record tag or commit so "update available" can be added later. Unauthenticated API calls are rate-limited, so cache responses and allow an optional token.
- **System fonts:** parse `.ttc` collections into individual styles. The picker scans `/System/Library/Fonts`, `/Library/Fonts` and `~/Library/Fonts`. Font Book collections are not readable and out of scope.
- **Offline:** previews for Google and Adobe entries cannot render without a network. Show a neutral "offline" state in the cell, never a broken or fallback-font specimen presented as the real font.

## Library UI

**Visual direction.** Very minimal and clean, modelled on the reference screenshot (split layout, hairline-bordered cells, strong type, lots of whitespace). Chrome uses the macOS system font so it never competes with specimens. Light and dark themes with a toggle.

**Layout**

- Narrow fixed sidebar (about 220px): Library, Collections, Tags, Sources, Playground, and an Add button.
- Slim toolbar above the content: search, layout switcher, shared preview-text field, size slider.
- Content area fills the rest, with 1px neutral borders between cells and no cards, shadows or rounded containers.

**Display layouts** (pluggable renderers over the same data, so more can be added later)

1. **Grid:** bordered cells, each showing the preview text set in the font, the family name and small metadata in the corners (source mark: Google, Adobe, GitHub, file, system; variable badge; style count). Actions (export, tag, open) appear on hover only.
2. **Rows:** one family per row with a longer sentence at a user-set size, family name and metadata in a left column.
3. *(Later)* Glyph grid in the style of Font Book's single-letter view.

**Shared controls:** custom preview text (persisted), size, and a style selector per family. Choosing a preview text for a script (Latin, Hebrew, etc.) should default to that script's sample when a font's coverage requires it.

**Filtering and organizing:** tags and collections; filter by source, variable or static, weight count, script coverage, OpenType features; search by name, designer, tag.

**Detail view:** all styles of a family, axis sliders for variable fonts, OpenType feature toggles, glyph map, source links, license, notes, and the export actions.

**Load behavior:** Google and Adobe fonts arrive asynchronously. Hold each cell's text hidden until `document.fonts.load()` resolves, then fade it in, so there is no fallback-font flash. This is the only animation needed in v1.

## Playground

A type-pairing workspace inspired by FontBase's playground. A fixed placeholder document (H1, H2, paragraph, list, blockquote) rendered with two font slots: heading and body.

- Each slot picks from the library only (any source) and has its own style or weight, size, line-height and letter-spacing controls.
- A swap button exchanges the two fonts; quick-cycle keys step through the library per slot.
- Editable text: the user can overwrite the placeholder copy; it persists per session.
- **Save pairing:** a pairing is a first-class object (name, both fonts and styles, per-role settings) that can be added to collections and reopened.
- **Copy CSS:** one action produces the `font-family` rules for the pairing, plus whichever Google link or Adobe kit reference it needs. Self-hosted entries output `@font-face` blocks with relative paths.
- Light and dark preview surface, toggleable independently of the app theme.
- Later: additional templates (landing hero, poster, RTL sample), per-role OpenType feature toggles.

## Export

*Revised Nov 25, 2026:* no conversion. The app keeps every format the designer provided (a style can hold its TTF, OTF and WOFF2 side by side), and "export" is **Show in Finder** on a family or a style's files, so the user copies what a project needs. Originals stay in the library folder. woff2 generation, subsetting and static instancing are dropped from v1; they could return later as an optional tool for sources that ship no web fonts.

| Source | Files |
| --- | --- |
| GitHub or file | Show in Finder on the stored originals (all imported formats) |
| System | Show in Finder on the installed file (many macOS system fonts are not redistributable) |
| Google | Link-only; the family page links to the specimen and repo. A later "fetch TTFs" action may download them from the google/fonts repo |
| Adobe | Kit link and `font-family` CSS only |

**Library backup.** A separate Export Library action writes the metadata as JSON plus the stored files, and a matching Import restores it. This covers a corrupted database or a new machine until real sync exists.

**License gate.** Read the license from the font and the source and show it in the detail view; warn before handing out files that are non-redistributable (system fonts).

## Edge cases and risks

- **Adobe origin check (highest risk).** Kit CSS may refuse to load from a non-allowed origin. Spike this before building the Adobe UI; fallbacks are a localhost origin or adding the app's origin to the kit's domains.
- **Adobe token and API drift.** The Typekit API is old and sparsely documented. Treat responses defensively and verify kit-editing endpoints against current docs before relying on them. Kit editing is out of scope for v1.
- **Kit propagation lag.** Changes to a kit take a moment to appear. Provide a Sync button and cache last-known kit state; never live-load on every launch.
- **Fragile system references.** Paths under `/System/Library/AssetsV2/...` change with OS updates. Store the PostScript name, re-resolve, and show a "missing" state instead of removing the entry.
- **Offline state.** Google and Adobe previews cannot render offline. Show an explicit offline cell state.
- **GitHub rate limits.** Cache API responses; support an optional personal token stored in the keychain.
- **Duplicates.** The same family can arrive from several sources; merge by family name plus PostScript name.
- **Font collections (.ttc).** Split into individual styles on import.
- **Variable fonts.** Show axes and sliders; keep static-instance export optional.
- **Licenses.** Do not silently export non-redistributable fonts.

## Milestones

Build in this order; each milestone should be usable on its own.

1. **Foundation and preview.** Vite app, SQLite schema, library folder, local file import with fontkit parsing, grid and rows layouts, preview-text controls, tags and collections, light and dark themes.
2. **System fonts and export.** System picker (path plus PostScript name, `.ttc` support, missing-state handling), detail view with axes and features, Show in Finder in place of export, Electron shell.
3. **Google Fonts.** Paste-link add, per-family metadata from the google/fonts repo, CSS2 preview, on-demand TTF fetch for export, offline state.
4. **Adobe Fonts.** Origin-check spike first, then token storage in the keychain, kit sync, selective import, link-only entries and embed snippets.
5. **GitHub import.** Repo URL, file and release listing, selective import, version and tag recorded, rate-limit handling.
6. **Playground and backup.** Heading and body pairing, saved pairings, copy CSS, library export and import. *(Project collections with bundle export were dropped on Nov 25, 2026.)*

## Open items

- [ ] App name.
- [ ] Design reference beyond the attached screenshot (other apps or sites to match). Until decided, the agent proposes a restrained neutral UI based on that screenshot.
- [ ] Frontend framework preference (React or Svelte); default to whichever the agent is strongest in.
- [ ] Whether GitHub entries should later gain a link-only mode (jsDelivr CDN) in addition to stored files.
- [ ] Whether a native helper for session-only font activation is ever wanted (out of scope for v1).
