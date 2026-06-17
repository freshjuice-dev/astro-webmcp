# Architecture — @freshjuice/astro-webmcp

## Overview

```
┌──────────────────────────────────────────────────────────┐
│                     BUILD TIME                           │
│                                                          │
│  Content Collections ──→ Hook astro:build:done           │
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
│       ├─ navigator.modelContext.provideContext()         │
│       │    ├── search_content (3 backends)               │
│       │    ├── list_sections                             │
│       │    ├── go_to (+ requestUserInteraction)          │
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
│  Chrome (149+) discovers tools via WebMCP protocol       │
│  Agent can search, list, navigate, and call custom tools │
└──────────────────────────────────────────────────────────┘
```

## Components

### 1. Astro Integration (`src/index.ts`)

Implements the `AstroIntegration` interface with three hooks:

#### `astro:config:setup`

- Uses `injectScript('head-inline', ...)` to insert the client-side script directly into `<head>` on every page
- **Why `head-inline`:** Bypasses Vite bundling — more reliable than `'page'` stage on Astro v6, which can drop the script during optimization
- Injects `__WEBMCP_CONFIG__` global with security settings, custom tools, form scanning toggle, and search backend config

#### `astro:server:setup`

- Serves a minimal dev manifest at `/_webmcp/manifest.json` for local development
- Dev manifest is a stub (hardcoded Home entry) — full manifest is only generated at build time

#### `astro:build:done`

- Receives `dir` (output directory) and `pages` (list of generated pages)
- Generates `/_webmcp/manifest.json` with enhanced metadata for each page
- Extracts collection information, tags, OpenGraph metadata, canonical URL, language, and word count
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
      "ogTitle": "My Article — Site Name",
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

### 3. Client-side Script (`src/client.ts`)

Runs in the browser on every page. Responsible for:

1. Checking WebMCP support (`'modelContext' in navigator`)
2. Fetching the manifest
3. Registering 4 built-in tools + custom tools + declarative forms

The script is lightweight (~3KB) and has zero impact on browsers without WebMCP support — it exits on the first check.

### 4. Search Backends

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
| `pagefind` | `window.pagefind.search()` — full-text | Falls back to manifest if pagefind not found or returns empty |
| `orama` | Dynamic `import('@orama/orama')` + `fetch(oramaIndexUrl)` — full-text | Falls back to manifest if import fails or returns empty |

**Orama dynamic import:** The `@orama/orama` package is only loaded when `backend='orama'` and a search is actually performed. It's not bundled — the dynamic `import()` only fires at runtime, keeping the base script small for sites that don't use Orama.

### 5. Custom Tools System

Custom tools are serialized into `__WEBMCP_CONFIG__` at build time and registered by the client script at runtime:

```
astro.config.mjs                    Build time
  customTools: [...]      ──────→   __WEBMCP_CONFIG__.customTools
                                          │
                                          ▼
                                    Browser runtime
                                    new Function(params, safeOutput, executeBody)
                                          │
                                          ▼
                                    navigator.modelContext.provideContext()
```

Each custom tool's `executeBody` is compiled via `new Function(params, safeOutput, body)` — it receives the tool's input params and the `safeOutput` helper (for sanitization + truncation).

### 6. Declarative Form Scanning

When `formScanning: true`, the client script scans the DOM for `<form>` elements with `name` and `description` attributes:

```
DOM scan
  querySelectorAll('form[name][description]')
       │
       ├─ Build inputSchema from form fields (name, type, required)
       ├─ Register tool via navigator.modelContext.registerTool()
       └─ execute: fill fields → form.requestSubmit()
```

This implements the spec's declarative API — the simplest path to WebMCP. No JS required in the form markup, just `name` and `description` attributes.

### 7. Security Layer

All tools apply Chrome Agent Security Guidelines:

| Mechanism | Where | Purpose |
|-----------|-------|---------|
| `readOnlyHint` | Tool annotations | Declares non-mutating tools |
| `untrustedContentHint` | Tool annotations | Marks tools returning UGC/external data |
| `requestUserInteraction()` | `go_to` execute | Prompts user consent before navigation |
| Output truncation | `safeOutput()` | Caps at `maxOutputLength` (default 1500 chars) |
| Prompt injection sanitization | `sanitize()` | Strips instruction patterns from output |
| `exposedTo` | `registerOptions` | Controls cross-origin tool access |

## WebMCP APIs Used

| API | Usage |
|-----|-------|
| `navigator.modelContext.provideContext()` | Batch-registers all tools at once (spec-preferred) |
| `navigator.modelContext.registerTool()` | Fallback individual registration |
| `navigator.modelContext.requestUserInteraction()` | User consent for `go_to` navigation |
| `inputSchema` (JSON Schema) | Defines typed parameters for agents |
| `execute` (async function) | Logic executed when agent calls the tool |

Reference: https://developer.chrome.com/docs/ai/webmcp/imperative-api

## Design Decisions

### Why JSON manifest instead of virtual module?

- Works for both SSG and SSR
- No complex Vite plugin needed
- Cache-friendly (static file served by CDN)
- Can be pre-generated by CI without running full Astro build

### Why multiple search backends?

- `manifest` search works everywhere with zero dependencies — good default
- `pagefind` and `orama` provide full-text search for larger sites
- Automatic fallback means the site never breaks — if a backend fails, it degrades gracefully to manifest search
- Dynamic import for Orama keeps the base script small

### Why `provideContext()` + `registerTool()` fallback?

- `provideContext()` is the spec-preferred batch method (sets all tools at once)
- `registerTool()` is the older individual method — kept as fallback for browsers that haven't updated
- Both paths produce identical results; the fallback is transparent

### Why `requestUserInteraction()` for `go_to`?

- Navigation is state-mutating — the user leaves the current page
- Chrome Agent Security Guidelines require user consent for mutating tools
- If the browser doesn't support `requestUserInteraction()` yet, navigation proceeds without prompt (graceful degradation)

### Why `head-inline` instead of `page`?

- Astro v6's `injectScript('page', ...)` can drop scripts during Vite optimization
- `head-inline` injects directly into `<head>` as a `<script>` tag — guaranteed delivery
- Same performance characteristics (the script is tiny and exits early on unsupported browsers)

### Why declarative form scanning is opt-in?

- Not all forms should be exposed as WebMCP tools (e.g., login forms, admin panels)
- Opt-in via `formScanning: true` gives developers control
- When enabled, only forms with explicit `name` and `description` attributes are registered — accidental exposure is prevented

## Future Extensibility

- **Additional search backends** — Meilisearch, Algolia, FlexSearch via the same pattern
- **Server-side search endpoint** — for sites with 10,000+ pages where client-side manifest is too large
- **Page state tools** — expose dynamic context (current article, breadcrumbs, active filters)
- **Auth-gated tools** — tools that only appear for authenticated users
- **Tool analytics** — track which tools agents call most frequently
