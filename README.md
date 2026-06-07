# astro-webmcp

[![npm version](https://img.shields.io/npm/v/astro-webmcp?color=blue)](https://www.npmjs.com/package/astro-webmcp)
[![npm downloads](https://img.shields.io/npm/dm/astro-webmcp)](https://www.npmjs.com/package/astro-webmcp)
[![Astro](https://img.shields.io/badge/Astro-6+-ff5d01?logo=astro&logoColor=white)](https://astro.build)
[![WebMCP](https://img.shields.io/badge/WebMCP-Chrome_149+-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/ai/webmcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Built--in_types-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> 🤖 Make your Astro site AI-agent ready in one line of code.

Astro integration that automatically exposes your site's content via [WebMCP](https://developer.chrome.com/docs/ai/webmcp) — allowing AI agents to discover, search, and navigate your content directly in the browser.

## What is WebMCP?

WebMCP is a proposed web standard by Chrome that lets websites declare structured "tools" for AI agents. Instead of an agent visually interpreting each page element, the site explicitly declares what can be done — search articles, navigate to sections, get page metadata.

- **Spec:** https://webmachinelearning.github.io/webmcp/
- **Chrome docs:** https://developer.chrome.com/docs/ai/webmcp
- **GitHub:** https://github.com/webmachinelearning/webmcp

## Installation

```bash
npm install astro-webmcp
```

## Basic usage

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import webmcp from 'astro-webmcp';

export default defineConfig({
  integrations: [webmcp()],
});
```

That's it. All your site content is now exposed via WebMCP automatically.

## Configuration options

```js
webmcp({
  collections: ['blog', 'docs'], // filter which collections to expose (default: all)
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `string[]` | `undefined` (all) | List of collections to include in the manifest |

## Registered tools

| Tool | Description |
|------|-------------|
| `search_content` | Search articles and pages by keyword |
| `list_sections` | List available content sections with item counts |
| `go_to` | Navigate to a specific page by slug |
| `get_page_info` | Get current page metadata (title, description, headings) |

### Tool schemas

#### `search_content`

```json
{
  "name": "search_content",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search term" },
      "collection": { "type": "string", "description": "Filter by collection (optional)" },
      "limit": { "type": "number", "description": "Max results (default: 5)" }
    },
    "required": ["query"]
  }
}
```

#### `list_sections`

```json
{
  "name": "list_sections",
  "inputSchema": { "type": "object", "properties": {} }
}
```

#### `go_to`

```json
{
  "name": "go_to",
  "inputSchema": {
    "type": "object",
    "properties": {
      "slug": { "type": "string", "description": "Page slug or path" }
    },
    "required": ["slug"]
  }
}
```

#### `get_page_info`

```json
{
  "name": "get_page_info",
  "inputSchema": { "type": "object", "properties": {} }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      BUILD TIME                          │
│                                                         │
│  Astro pages ────→ Hook astro:build:done                │
│                         │                               │
│                         ▼                               │
│                   /_webmcp/manifest.json                 │
│                   (titles, slugs, descriptions)          │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    RUNTIME (Browser)                     │
│                                                         │
│  Injected script (injectScript)                         │
│       │                                                 │
│       ├─ fetch('/_webmcp/manifest.json')                │
│       │                                                 │
│       └─ navigator.modelContext.registerTool()          │
│            ├── search_content                           │
│            ├── list_sections                            │
│            ├── go_to                                    │
│            └── get_page_info                            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      AI AGENT                           │
│                                                         │
│  Chrome 149+ discovers tools via WebMCP protocol        │
│  Agent can search, list, and navigate site content      │
└─────────────────────────────────────────────────────────┘
```

### Components

**Integration (`src/index.ts`)** — implements `AstroIntegration` with three hooks:

- `astro:config:setup` — injects the client-side script into every page via `injectScript`
- `astro:server:setup` — serves a dynamic manifest during development
- `astro:build:done` — generates `/_webmcp/manifest.json` by extracting titles and descriptions from built HTML

**Client script (`src/client.ts`)** — runs in the browser on every page:

1. Feature detection: `document.modelContext ?? navigator.modelContext`
2. Fetches the manifest from `/_webmcp/manifest.json`
3. Registers 4 tools with JSON Schema input definitions

**Manifest (`/_webmcp/manifest.json`)** — static JSON generated at build time:

```json
{
  "generatedAt": "2026-06-07T00:45:30.260Z",
  "site": "https://example.com",
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
      "collection": "blog"
    }
  ]
}
```

### Design decisions

| Decision | Rationale |
|----------|-----------|
| Static JSON manifest (not virtual module) | Works for both SSG and SSR, CDN-cacheable, no complex Vite plugin needed |
| Client-side search | No server endpoint needed for small/medium sites (<1000 pages) |
| Imperative API (not Declarative) | Search and navigation aren't forms — they need JS logic |
| Feature detection with fallback | Chrome 149 uses `navigator.modelContext`, 150+ uses `document.modelContext` |

## Testing

### 1. Enable WebMCP in Chrome

Navigate to `chrome://flags/#enable-webmcp-testing` → **Enabled** → Relaunch.

### 2. Install the test extension

[Model Context Tool Inspector](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd)

### 3. Verify tools in DevTools Console

```js
// Chrome 149
const tools = await navigator.modelContext.getTools();
console.table(tools.map(t => ({ name: t.name, description: t.description })));

// Chrome 150+
const tools = await document.modelContext.getTools();
console.table(tools.map(t => ({ name: t.name, description: t.description })));
```

### 4. Execute a tool manually

```js
const tools = await navigator.modelContext.getTools();
const search = tools.find(t => t.name === 'search_content');
const result = await navigator.modelContext.executeTool(search, '{"query": "astro"}');
console.log(JSON.parse(result));
```

## Combining with Declarative API

This plugin uses the Imperative API for search and navigation. For existing forms on your site, you can add the Declarative API manually — both coexist:

```html
<form toolname="send_message"
      tooldescription="Send a contact message."
      toolautosubmit
      action="/api/contact">
  <label for="email">Email</label>
  <input type="email" name="email" required>
  <label for="message">Message</label>
  <textarea name="message" required></textarea>
  <button type="submit">Send</button>
</form>
```

The agent will see **both** the integration tools + declarative form tools.

## Compatibility

| Browser | Support |
|---------|---------|
| Chrome 149+ | ✅ (flag or origin trial) |
| Other browsers | ❌ (script exits immediately, zero impact) |

The plugin is a **progressive enhancement** — sites continue working normally on unsupported browsers.

## Security

### What is exposed

The plugin only exposes information that is **already publicly accessible** on your site:

| Data | Source | Equivalent to |
|------|--------|---------------|
| Page URLs | Built HTML files | `sitemap.xml` |
| Page titles | `<title>` tag | View source / search engines |
| Descriptions | `<meta name="description">` | View source / search engines |
| Headings (h1-h3) | DOM elements | Visible on page |

**The manifest (`/_webmcp/manifest.json`) contains no more information than your `sitemap.xml` already provides to every crawler.**

### What is NOT exposed

- ❌ No server-side data, APIs, or endpoints
- ❌ No authentication tokens or credentials
- ❌ No admin routes or private pages
- ❌ No user data (the plugin is fully static/client-side)
- ❌ No environment variables or build secrets

### Tool security

| Tool | Action | Risk |
|------|--------|------|
| `search_content` | Filters pre-loaded JSON client-side | Read-only, no network calls |
| `list_sections` | Returns static collection list | Read-only |
| `go_to` | Sets `window.location.href` to a known URL | Navigation only, same as clicking a link |
| `get_page_info` | Reads DOM title, meta, headings | Same as view-source |

### Design principles

- **No arbitrary code execution** — tools only read static data or navigate
- **No `innerHTML`** — all output is `JSON.stringify`, no XSS vector
- **No external requests** — the manifest is fetched from same-origin only
- **Progressive enhancement** — on unsupported browsers, the script exits immediately with zero side effects
- **Origin-isolated** — WebMCP requires origin isolation; cross-origin iframes cannot access tools unless explicitly allowed

## Troubleshooting

### Tools don't appear

1. Check that `chrome://flags/#enable-webmcp-testing` is enabled
2. Verify in the Network tab that `/_webmcp/manifest.json` returns 200
3. In Console, check `navigator.modelContext` (Chrome 149) or `document.modelContext` (150+)

### Empty manifest

- Confirm the build completed without errors
- The manifest is generated from built HTML pages — ensure `astro build` succeeds

### Search returns no results

- Search is case-insensitive across `title`, `description`, and `tags` fields
- If your pages have no `<meta name="description">`, search only matches on `title`

## Requirements

- Astro 6+
- Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled (or origin trial)
- Origin-isolated document (Astro default)

## Status

🚧 Early development — WebMCP is an evolving standard (developer trial in Chrome 149+).

## License

MIT

## Author

Contact the author: https://ft.ia.br
