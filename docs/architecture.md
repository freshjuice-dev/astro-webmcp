# Architecture — @freshjuice/astro-webmcp

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                     BUILD TIME                          │
│                                                         │
│  Content Collections ──→ Hook astro:build:done          │
│  (blog, docs, etc.)      │                              │
│                           ▼                             │
│                    Manifest JSON                        │
│                    /_webmcp/manifest.json               │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     RUNTIME (Browser)                   │
│                                                         │
│  Injected script (head-inline)                          │
│       │                                                 │
│       ├─ fetch('/_webmcp/manifest.json')                │
│       │                                                 │
│       └─ navigator.modelContext.registerTool()          │
│            ├── search_content                           │
│            ├── list_sections                            │
│            ├── go_to                                    │
│            ├── get_page_info                            │
│            └── custom tools (user-defined)              │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     AI AGENT                            │
│                                                         │
│ Chrome (149+) discovers tools via WebMCP protocol       │
│ Agent can search, list, navigate, and call custom tools │
└─────────────────────────────────────────────────────────┘
```

## Components

### 1. Astro Integration (`src/index.ts`)

Implements the `AstroIntegration` interface with two main hooks:

#### `astro:config:setup`

- Uses `injectScript('head-inline', ...)` to insert the client-side script directly into `<head>` on every page
- **Why `head-inline`:** Bypasses Vite bundling — more reliable than `'page'` stage on Astro v6, which can drop the script during optimization
- The script does feature detection (`'modelContext' in navigator`) before registering tools
- Loads the manifest via `fetch` and registers tools with `navigator.modelContext.registerTool()`
- Injects `__WEBMCP_CONFIG__` global with security settings + custom tools

#### `astro:build:done`

- Receives `dir` (output directory) and `pages` (list of generated pages)
- Generates `/_webmcp/manifest.json` with metadata for each page
- Extracts collection information when available
- Respects `collections` filter option

### 2. Manifest (`/_webmcp/manifest.json`)

Static JSON file generated at build time:

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
      "tags": ["astro", "webmcp"]
    }
  ]
}
```

### 3. Client-side Script (`src/client.ts`)

Runs in the browser on every page. Responsible for:

1. Checking WebMCP support (`'modelContext' in navigator`)
2. Fetching the manifest
3. Registering 4 built-in tools + any custom tools from config

The script is lightweight (~1.5KB gzipped) and has zero impact on browsers without WebMCP support — it exits on the first check.

### 4. Custom Tools System

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
                                    navigator.modelContext.registerTool()
```

Each custom tool's `executeBody` is compiled via `new Function(params, safeOutput, body)` — it receives the tool's input params and the `safeOutput` helper (for sanitization + truncation).

## WebMCP APIs Used

| API | Usage |
|-----|-------|
| `navigator.modelContext.registerTool()` | Registers each tool with name, description, schema, and executor |
| `inputSchema` (JSON Schema) | Defines typed parameters for agents |
| `execute` (async function) | Logic executed when agent calls the tool |

Reference: https://developer.chrome.com/docs/ai/webmcp/imperative-api

## Design Decisions

### Why JSON manifest instead of virtual module?

- Works for both SSG and SSR
- No complex Vite plugin needed
- Cache-friendly (static file served by CDN)
- Can be pre-generated by CI without running full Astro build

### Why client-side search?

- Small/medium sites (<1000 pages): manifest is lightweight, search is instant
- No server-side endpoint required
- For large sites: future option of `/api/webmcp-search` endpoint via middleware

### Why Imperative API (not Declarative)?

- Declarative API only works for existing forms
- Search and navigation aren't forms — they need JS logic
- Imperative gives full control over what the tool does
- Custom tools require imperative API by nature

### Why `head-inline` instead of `page`?

- Astro v6's `injectScript('page', ...)` can drop scripts during Vite optimization
- `head-inline` injects directly into `<head>` as a `<script>` tag — guaranteed delivery
- Same performance characteristics (the script is tiny and exits early on unsupported browsers)

## Future Extensibility

- **Full-text search** — integrate with Pagefind or similar instead of simple manifest search
- **Automatic declarative** — detect `<form>` elements and inject `toolname` via rehype plugin
- **Page state** — expose dynamic context (current article, breadcrumbs, active filters)
- **Server-side search endpoint** — for sites with 1000+ pages
