# Architecture: @freshjuice/astro-webmcp

## Overview

```
┌──────────────────────────────────────────────────────────┐
│                     BUILD TIME                           │
│                                                          │
│  Generated pages ─────→ Hook astro:build:done            │
│  (blog, docs, etc.)      │                               │
│                          ▼                               │
│                    Manifest JSON                         │
│                    /_webmcp/manifest.json                │
│                    (enhanced: tags, OG, lang, wc)        │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                     RUNTIME (Browser)                    │
│                                                          │
│  Injected script (head-inline)                           │
│       │                                                  │
│       ├─ fetch('/_webmcp/manifest.json')                 │
│       │                                                  │
│       ├─ document.modelContext.registerTool()            │
│       │    ├── search_content (3 backends)               │
│       │    ├── list_sections                             │
│       │    ├── go_to (navigation)                       │
│       │    ├── get_page_info (enhanced)                  │
│       │    └── custom tools (user-defined)               │
│       │                                                  │
│       └─ scanDeclarativeForms() (if formScanning: true)  │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                     AI AGENT                             │
│                                                          │
│  Experimental Chrome discovers tools via WebMCP          │
│  Agent can search, list, navigate, and call custom tools │
└──────────────────────────────────────────────────────────┘
```

## Components

### 1. Astro integration (`src/index.ts`)

Implements the `AstroIntegration` interface with three hooks:

#### `astro:config:setup`

- Uses `injectScript('head-inline', ...)` to insert the client-side script directly into `<head>` on every page
- `head-inline` bypasses Vite bundling so the injected script is not processed as a page module
- Injects `__WEBMCP_CONFIG__` global with security settings, custom tools, form scanning toggle, and search backend config
- Adds middleware in SSR mode. Its manifest response is limited; it does not crawl dynamic routes, enumerate Content Collections, or build a complete content index.

#### `astro:server:setup`

- Serves a minimal dev manifest at `/_webmcp/manifest.json` for local development
- The dev manifest is a hardcoded Home-only stub; the build produces the generated-page manifest

#### `astro:build:done`

- Receives `dir` (output directory) and `pages` (list of generated pages)
- Generates `/_webmcp/manifest.json` with enhanced metadata for each page
- Groups generated pages by their first URL path segment and extracts tags, OpenGraph metadata, canonical URL, language, and word count from available HTML
- Respects `collections` filter option

### 2. Manifest (`/_webmcp/manifest.json`)

Static JSON file generated at build time with enhanced metadata:

```json
{
  "collections": [
    { "name": "blog", "count": 42 },
    { "name": "docs", "count": 15 }
  ],
  "entries": [
    {
      "slug": "blog/my-article",
      "url": "/blog/my-article/",
      "title": "My Article",
      "description": "Article summary",
      "collection": "blog",
      "tags": ["astro", "webmcp"],
      "ogTitle": "My Article: Site Name",
      "ogDescription": "A richer OpenGraph description",
      "canonical": "https://mysite.com/blog/my-article/",
      "lang": "en",
      "wordCount": 850
    }
  ]
}
```

**Metadata extraction sources:**

| Field | Source |
|-------|--------|
| `title` | `<title>` tag |
| `description` | `<meta name="description">` |
| `tags` | `<meta name="keywords">` + `<meta property="article:tag">` |
| `ogTitle` | `<meta property="og:title">` |
| `ogDescription` | `<meta property="og:description">` |
| `canonical` | `<link rel="canonical">` |
| `lang` | `<html lang="...">` |
| `wordCount` | Approximate count from `<main>` text content |

### 3. Client-side script (`src/client.ts`)

Runs in the browser on every page. Responsible for:

1. Checking `document.modelContext.registerTool`, with `navigator.modelContext` only as a legacy preview fallback
2. Fetching the manifest
3. Preparing four built-in tools, custom tools, and opted-in scanned forms, then awaiting each registration
4. Aborting the shared registration controller on any compilation or registration failure to roll back the whole integration-owned batch
5. Cleaning up before Astro page-transition initialization and discarding stale asynchronous work

Unsupported browsers still load the injected script but exit before fetching the manifest or registering tools. Registration rollback is an application lifecycle policy, not a native atomic batch operation; tools may be discoverable while a successful batch is being registered.

### 4. Search backends

`search_content` supports three backends with automatic fallback:

```
searchContent(query)
       │
       ├─ backend='pagefind'? → searchPagefind() → fallback to manifest
       ├─ backend='orama'?    → searchOrama()    → fallback to manifest
       └─ default             → searchManifest()
```

| Backend | Implementation | Fallback |
|---------|---------------|----------|
| `manifest` | Substring match on `title`, `description`, `tags` | N/A (always works) |
| `pagefind` | Full-text via `window.pagefind.search()` | Falls back to manifest if pagefind not found or returns empty |
| `orama` | Full-text via dynamic `import('@orama/orama')` + `fetch(oramaIndexUrl)` | Falls back to manifest if import fails or returns empty |

The runtime imports `@orama/orama` only when an Orama search is performed. It is not bundled; the browser must be able to resolve the import or search falls back to the manifest.

### 5. Custom tools system

Custom tools are serialized into `__WEBMCP_CONFIG__` at build time and registered by the client script at runtime:

```
astro.config.mjs                    Build time
  customTools: [...]      ──────→   __WEBMCP_CONFIG__.customTools
                                          │
                                          ▼
                                    Browser runtime
                                    Async body(params, safeOutput, signal)
                                          │
                                          ▼
                                    document.modelContext.registerTool()
```

Each custom tool's `executeBody` is dynamically compiled as an async function body with `params`, `safeOutput`, and `signal`. It supports `await` and runs as public browser code, without access to config closures. The native callback is `execute(params, { signal })`; the body receives that per-execution signal, not the registration controller's signal. Pass it to cancellable work such as `fetch()`.

Custom tools support an optional `title`, `outputSchema`, and the `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, and `debugging` annotations. `readOnlyHint` defaults to `false`, so read-only tools must opt in explicitly. Chrome documents `debugging` from version 156. If `outputSchema` is provided, it must match the tool's returned structure.

`safeOutput()` produces the package's MCP-style text-content envelope after heuristic filtering and truncation. WebMCP accepts JSON-serializable results without requiring that envelope. Truncation can make the inner text invalid JSON. Dynamic compilation must be compatible with the site's Content Security Policy; tool bodies must be trusted code and contain no secrets.

### 6. Declarative form scanning

When `formScanning: true`, the client scans forms with Chrome's experimental `toolname`/`tooldescription` or legacy `name`/`description` attributes:

```
DOM scan
  querySelectorAll('form[toolname][tooldescription], form[name][description]')
       │
       ├─ Build inputSchema from form fields (name, type, required, toolparamdescription)
       ├─ Check names against the integration's tool batch
       ├─ Await registration as part of that batch
       └─ execute: fill fields; requestSubmit() only with toolautosubmit
```

This is an opt-in package extension, not a complete polyfill for Chrome's experimental [Declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api). Declarative forms were removed from the community draft in October 2026 ([PR #338](https://github.com/webmachinelearning/webmcp/pull/338)). The scanner checks `getTools()` and skips experimental native form names registered in the current window. Test registration timing in the target browser and keep scanning off when native registration already handles the forms. Calling `requestSubmit()` does not establish that the server-side action succeeded.

### 7. Security layer

The package provides hints and output controls, not an application security boundary. Follow Chrome's [tool security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools) and enforce consent, input validation, authentication, and authorization in the application service used by both the UI and tools.

| Mechanism | Where | Purpose |
|-----------|-------|---------|
| `readOnlyHint` | Tool annotations | Declares non-mutating tools |
| `untrustedContentHint` | Tool annotations | Marks tools returning UGC/external data |
| `consequentialHint` | Custom tool annotations | Describes significant effects; does not enforce consent |
| `requestUserInteraction()` | `go_to` compatibility path | Used only when available; otherwise navigation has no such prompt |
| Output truncation | `safeOutput()` | Caps at `maxOutputLength` (default 1500 chars) |
| Heuristic filtering | `sanitize()` | Removes some instruction patterns; cannot guarantee protection from prompt injection |
| `exposedTo` | `registerOptions` | Provider opt-in for secure caller origins |

Cross-origin discovery also requires the caller's `getTools({ fromOrigins: [...] })` opt-in. Registration in cross-origin frames needs `allow="tools"` permissions delegation. These gates are separate from application authorization. A schema-valid call can still be unauthorized.

## WebMCP APIs used

| API | Usage |
|-----|-------|
| `document.modelContext.registerTool(tool, options)` | Awaited registration; returns `Promise<void>` |
| Registration `options.signal` | Unregisters on abort; distinct from execution cancellation |
| `document.modelContext.getTools(options)` | Discovers descriptors; `fromOrigins` opts in to secure provider origins |
| `document.modelContext.executeTool(descriptor, inputObject, options)` | Executes a discovered descriptor with object input; `options.signal` cancels that call |
| `toolchange`, `toolactivated`, `toolcancel` | Events on `modelContext`; activation/cancellation identify the tool |
| `inputSchema` (JSON Schema) | Defines typed parameters for agents |
| `execute(params, { signal })` | Async callback with a per-execution cancellation signal |

Reference: https://developer.chrome.com/docs/ai/webmcp/imperative-api

The current [community draft IDL](https://webmachinelearning.github.io/webmcp/#idl-index) exposes `modelContext` on `Document` in secure contexts. It includes neither `provideContext()` nor `requestUserInteraction()`. The latter remains only a feature-detected compatibility path in `go_to`, not a consent guarantee. Chrome's experimental implementation and the community draft can differ; consult [Chrome Status](https://chromestatus.com/feature/5117755740913664) for availability rather than assuming stable support from a version number.

## Design decisions

### Why JSON manifest instead of virtual module?

- Static builds generate page metadata; the limited SSR middleware does not provide a complete dynamic index
- No complex Vite plugin needed
- Cache-friendly (static file served by CDN)
- Can be pre-generated by CI without running full Astro build

### Why multiple search backends?

- `manifest` search needs only a valid manifest and no search dependency
- `pagefind` and `orama` provide full-text search for larger sites
- If a search backend fails, the client falls back to manifest search
- Dynamic import for Orama keeps the base script small

### Why awaited registration with rollback?

- `registerTool()` is the current registration API; `provideContext()` is absent from the current draft.
- Awaiting each call catches asynchronous rejection. Any compilation or registration failure aborts the shared controller, removing the integration's batch, including scanned forms.
- Cleanup runs before a replacement initialization. Stale initialization work must not overwrite the active page's registrations.
- The registration signal controls discovery lifetime. Per-call cancellation comes from the native execution callback; unregistering does not cancel in-flight work in the current API (Chrome documents this behavior from version 153).

### Who owns confirmation and cancellation?

- The application owns confirmation for consequential actions. Neither annotations nor the optional compatibility hook replace it.
- Bind confirmation to the exact resource and current state, reject stale plans, and validate permissions again at commit.
- Define the irreversible commit boundary. Cancellation before commit must prevent the action; a later abort cannot promise to undo a server-side change.
- Resolve success only after the committed state and UI agree. Share the validation and side-effect service between tools, UI, and tests.

### Why `head-inline` instead of `page`?

- Astro's `injectScript('page', ...)` can drop scripts during Vite optimization
- `head-inline` injects directly into `<head>` as a `<script>` tag; the site's Content Security Policy still applies
- Configuration escapes `<` to prevent script-element termination. An IIFE isolates client bindings; the bundled client is required rather than replaced with a reduced fallback.
- Same performance characteristics (the script is tiny and exits early on unsupported browsers)

### Why declarative form scanning is opt-in?

- Not all forms should be exposed as WebMCP tools (e.g., login forms, admin panels)
- Opt-in via `formScanning: true` gives developers control
- When enabled, forms need either `toolname`/`tooldescription` or legacy `name`/`description` annotations. Review every matching form; attributes are not an authorization boundary.

## Verification

Run `npm test` to build and execute `node --test tests/*.test.mjs`. Mocked API checks do not prove native browser compatibility. Follow the [manual Chrome smoke test](usage.md#testing-locally) for discovery, object-input execution, events, registration rollback, page transitions, per-call cancellation, and cross-origin denial cases.

For agent evaluations, pin the package, browser build and flags/trial, spec revision, model/agent version, and fixture state. Evaluate real task outcomes as well as schema handling. Include authorization failures, stale confirmations, retries, and cancellation on both sides of the commit boundary. See Chrome's [best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices) and [evaluation guide](https://developer.chrome.com/docs/ai/webmcp/evals).

## Future extensibility

- Additional search backends: Meilisearch, Algolia, or FlexSearch
- Server-side search for sites whose manifest is too large for client-side search
- Page-state tools for dynamic context such as active filters
- Auth-gated tool visibility, alongside server-enforced authorization
- Tool-call analytics
