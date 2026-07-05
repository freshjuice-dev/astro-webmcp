# Changelog

All notable changes to `@freshjuice/astro-webmcp` will be documented in this file.

## [1.2.0] — 2026-07-05

### Added
- **Astro 7 support** — peerDependency range widened to `^6.0.0 || ^7.0.0`. Verified against Astro 7.0.6.
- **Agent Skills Discovery** — generates `/.well-known/skills/index.json` (opt-out via `skills: false`). Includes built-in tools + custom tools.
- **SSR middleware** — registers `middleware.mjs` when `output !== 'static'` for dynamic manifest serving with route caching support.
- **Route caching detection** — logs `[route-caching]` when Astro 7 `config.cache` is present.
- **Heading IDs** — `extractMeta()` extracts `<h1-h6 id="...">` for deep-linking; `get_page_info` returns heading IDs from live DOM.
- **`<a rel="tag">` extraction** — tags parsed from `<meta keywords>`, `<meta article:tag>`, and `<a rel="tag">`.
- **`title` field on all tools** — per spec, USVString for native UI display. Custom tools auto-generate title from name.
- **`outputSchema` on `CustomTool`** — forward-compat placeholder for spec Issue #9.
- **`ToolContentResponse` type** — exported for consumers.
- **Dev-only browser logging** — `debug` flag in `__WEBMCP_CONFIG__`, true on dev/preview, false on build. `console.info`/`debug` gated, `console.warn` always visible.
- **Structured build-time logging** — config summary (tools, search backend, form scanning, skills, security), collection breakdown with counts.

### Changed
- **`registerTool()` is now the primary API** — `provideContext()` was removed from spec (PR #205). Kept as fallback for older Chrome previews, gated by `typeof` check.
- **Structured content response** — `safeOutput()` returns `{ content: [{ type: 'text', text }] }` per MCP protocol format.
- **`AbortController` / `signal`** in registerOptions, `__WEBMCP_ABORT__` for SPA cleanup.
- **View Transitions support** — `initWebMCP()` extracted to named function, re-registers tools on `astro:after-swap`. Without this, tools disappeared after SPA navigation.
- `extractMeta()` spreads into entry via `...meta` (conditional fields omitted when empty).
- Dev manifest sets `Cache-Control: no-cache`.
- `@vite-ignore` on Orama dynamic import.

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
