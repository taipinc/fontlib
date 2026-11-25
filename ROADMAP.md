# Roadmap

Ideas for future development, roughly grouped. Nothing here is scheduled; if one of these matters to you, open an issue or a pull request.

## Library and browsing

- **More filters.** Filter by variable or static, number of weights, script coverage (Latin, Hebrew, Cyrillic…) and OpenType features. The data is already stored for every style; only the filter UI is missing.
- **Script-aware preview text.** When a family doesn't cover the preview text's script, fall back to a sample in a script it does cover (for example a Hebrew sample for a Hebrew-only font).
- **Glyph grid layout.** A third library layout showing one large letter per family, in the style of Font Book.
- **Configurable library location.** Let the library folder live anywhere (for example in a synced folder), instead of only `~/Library/Application Support/FontLib/`.

## Sources

- **Glyph maps for Google Fonts.** Google families are link-only, so the glyph map has no file to read. Fetch the font from the google/fonts repository once, when the Glyphs tab is first opened, and cache it.
- **"Update available" for GitHub fonts.** The release tag and commit are recorded at import; compare them with the repository's latest release and offer to update.
- **Optional GitHub token.** Anonymous GitHub API calls are limited to 60 an hour. Allow a personal token, stored in the macOS Keychain, for heavy use.
- **Link-only GitHub entries.** Optionally reference a repository's fonts through the jsDelivr CDN instead of copying the files.
- **Adobe Fonts API token.** Use the Adobe Fonts (Typekit) API to list all web projects and get the proper family names, instead of names derived from the kit's CSS. The API is old and sparsely documented, so check it still works first.

## Files and projects

- **Copy to Folder.** Copy a family's or a selection's original files (chosen formats) to a project folder, as an alternative to Show in Finder.
- **License warning.** Warn before handing out files of fonts that aren't redistributable, such as many fonts that ship with macOS.
- **Optional web font conversion.** Generate WOFF2 files, subsets or static instances for sources that ship none. Dropped from v1 in favour of keeping the designer's own files; could return as an opt-in tool.
- **Project bundles.** Gather every font of a collection (files, Google and Adobe embed snippets, pairing CSS) into one folder for a project. Dropped from v1.

## Playground

- **More templates.** A landing-page hero, a poster, a right-to-left sample.
- **Per-role OpenType features.** Feature toggles for the heading and body fonts.

## Project health

- **Automated tests.** A test suite for the importer, merge logic, source parsers and backup, so contributors can change things safely.
- **Packaged app.** An unsigned `.app`/`.dmg` build so people can try FontLib without running it from source; a signed and notarised build needs an Apple Developer account.
- **Sync between machines.** For now, use File → Export Library and Import Library.
- **Session-only font activation.** A small native helper to activate fonts for the current session without installing them. Out of scope so far.
