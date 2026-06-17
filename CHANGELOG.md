# Changelog

All notable changes to `@freshjuice/astro-webmcp` will be documented in this file.

## [1.1.0] — 2026-06-18

### Added
- **Search backend support** — `search_content` now supports three backends:
  - `manifest` (default): substring search on the generated manifest
  - `pagefind`: full-text search via Pagefind (requires `astro-pagefind` or `pagefind` on the page)
  - `orama`: full-text search via Orama (requires `@freshjuice/astro-search-plugin` or similar, with a pre-built index URL)
- **Declarative form scanning** — opt-in via `formScanning: true`. Auto-registers `<form name="..." description="...">` elements as WebMCP tools, implementing the spec's declarative API.
- **`requestUserInteraction()` for `go_to`** — navigation now prompts user consent before redirecting, per Chrome Agent Security Guidelines for state-mutating tools.
- **`provideContext()` batch registration** — uses the spec-preferred batch method when available, falls back to individual `registerTool()` calls.
- **Enhanced metadata extraction** — manifest entries now include:
  - `tags` (from `<meta name="keywords">` and `<meta property="article:tag">`)
  - `ogTitle` / `ogDescription` (OpenGraph metadata)
  - `canonical` URL
  - `lang` (from `<html lang>`)
  - `wordCount` (approximate, from `<main>` content)
- **Enhanced `get_page_info`** — now returns `lang`, `canonical`, and `wordCount` in addition to title, description, headings, and URL.
- **CHANGELOG.md** — this file.

### Changed
- `search_content` now searches `tags` in addition to title and description (tags were previously defined in the type but never populated).
- `get_page_info` description updated to reflect new fields.
- `go_to` now annotated with `readOnlyHint: false` (was already false, now documented as mutating).

### Fixed
- **Tags extraction** — `ManifestEntry.tags` was defined in the type but never populated by `extractMeta()`. Now extracted from `<meta name="keywords">` and `<meta property="article:tag">`.

## [1.0.0] — 2026-06-17

### Added
- Initial FreshJuice fork of `astro-webmcp` (fabricioctelles/astro-webmcp).
- **`head-inline` script injection** — fixes `injectScript` bug on Astro v6.4.2+ where client JS was silently dropped by Vite bundling.
- **`customTools` API** — define domain-specific tools declaratively in `astro.config.mjs` via `customTools` option.
- **Chrome Agent Security Guidelines** — annotations (`readOnlyHint`, `untrustedContentHint`), output length caps, prompt injection sanitization, cross-origin control via `exposedTo`.
- English documentation throughout (README, docs/architecture.md, docs/usage.md).
- Rebranded as `@freshjuice/astro-webmcp` v1.0.0.
