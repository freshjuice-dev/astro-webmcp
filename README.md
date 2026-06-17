# @freshjuice/astro-webmcp

[![npm version](https://img.shields.io/npm/v/@freshjuice/astro-webmcp?color=orange)](https://www.npmjs.com/package/@freshjuice/astro-webmcp)
[![Astro](https://img.shields.io/badge/Astro-6+-ff5d01?logo=astro&logoColor=white)](https://astro.build/)
[![WebMCP](https://img.shields.io/badge/WebMCP-Chrome_149+-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/ai/webmcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Astro integration that exposes your site content via WebMCP for AI agents.** Make your Astro site AI-agent ready in one line of code.

---

## What is WebMCP?

WebMCP is a proposed web standard by Chrome that lets websites declare structured **tools** for AI agents. Instead of an agent visually interpreting each page element, the site explicitly declares what can be done — search articles, navigate to sections, get page metadata.

- **Spec:** [https://webmachinelearning.github.io/webmcp/](https://webmachinelearning.github.io/webmcp/)
- **Chrome docs:** [https://developer.chrome.com/docs/ai/webmcp](https://developer.chrome.com/docs/ai/webmcp)
- **GitHub:** [https://github.com/webmachinelearning/webmcp](https://github.com/webmachinelearning/webmcp)

---

## Installation

```bash
npm install @freshjuice/astro-webmcp
```

## Basic Usage

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import webmcp from '@freshjuice/astro-webmcp';

export default defineConfig({
  integrations: [webmcp()],
});
```

All site content is automatically exposed via WebMCP.

---

## Configuration

```js
webmcp({
  // Filter which collections to expose (default: all)
  collections: ['blog', 'docs'],

  // Custom tools — expose your own domain-specific functionality
  customTools: [
    {
      name: 'search_products',
      description: 'Search the product catalog by name, category, or keyword.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
        },
        required: ['query'],
      },
      executeBody: `return fetch('/api/search?q=' + encodeURIComponent(params.query))
        .then(r => r.json())
        .then(d => safeOutput(d));`,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    },
  ],

  // Auto-register annotated <form> elements as WebMCP tools
  formScanning: true,

  // Search backend for search_content (default: 'manifest')
  search: {
    backend: 'pagefind',       // 'manifest' | 'pagefind' | 'orama'
    oramaIndexUrl: '/search-index.json',  // required for 'orama'
    pagefindBundlePath: '/pagefind/',     // default for 'pagefind'
  },

  // Security options
  security: {
    exposedTo: [],          // origins allowed cross-origin access (default: none)
    maxOutputLength: 1500,  // max chars per tool output (default: 1500)
    sanitizeOutputs: true,  // strip prompt injection patterns (default: true)
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `string[]` | `undefined` (all) | List of collections to include in the manifest |
| `customTools` | `CustomTool[]` | `[]` | Domain-specific tools to register alongside built-in ones |
| `formScanning` | `boolean` | `false` | Auto-register `<form name="..." description="...">` elements as tools |
| `search.backend` | `'manifest' \| 'pagefind' \| 'orama'` | `'manifest'` | Search backend for `search_content` |
| `search.oramaIndexUrl` | `string` | — | URL of pre-built Orama index (required for `'orama'`) |
| `search.pagefindBundlePath` | `string` | `'/pagefind/'` | Pagefind bundle path |
| `security.exposedTo` | `string[]` | `[]` | Origins allowed to access tools cross-origin |
| `security.maxOutputLength` | `number` | `1500` | Character limit per tool output |
| `security.sanitizeOutputs` | `boolean` | `true` | Strip patterns that resemble prompt injection |

### Custom Tools

The `customTools` array lets you expose your own site-specific functionality. Each tool needs:

- `name` — unique tool identifier
- `description` — natural language description for AI agents
- `inputSchema` — JSON Schema for the tool's parameters
- `executeBody` — function body (runs in browser). Receives `params` and `safeOutput`. Must return data or a Promise.
- `annotations` — optional security hints (`readOnlyHint`, `untrustedContentHint`)

### Search Backends

`search_content` supports three backends, with automatic fallback to manifest search:

| Backend | Description | Requires |
|---------|-------------|----------|
| `manifest` (default) | Substring search on the generated manifest | Nothing — always works |
| `pagefind` | Full-text search via Pagefind | `astro-pagefind` or `pagefind` on the page |
| `orama` | Full-text search via Orama | `@freshjuice/astro-search-plugin` or similar, with `oramaIndexUrl` |

### Declarative Form Scanning

When `formScanning: true`, any `<form>` element with `name` and `description` attributes is auto-registered as a WebMCP tool:

```html
<form name="search_products" description="Search product catalog by keyword">
  <input name="query" type="text" required>
  <button type="submit">Search</button>
</form>
```

The integration builds the input schema from form fields and submits the form when the agent calls the tool. This implements the spec's declarative API — no JS required.

---

## Registered Tools

| Tool | Description |
|------|-------------|
| `search_content` | Search articles and pages by keyword (supports manifest, Pagefind, or Orama backends) |
| `list_sections` | List available content sections with item counts |
| `go_to` | Navigate to a specific page by slug (prompts user consent via `requestUserInteraction`) |
| `get_page_info` | Get current page metadata (title, description, headings, language, word count, canonical URL) |
| *declarative forms* | Any `<form name="..." description="...">` when `formScanning: true` |
| *your custom tools* | Whatever you define via `customTools` |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      BUILD TIME                          │
│                                                          │
│  Astro pages ────→ Hook astro:build:done                 │
│                         │                                │
│                         ▼                                │
│                   /_webmcp/manifest.json                 │
│                   (titles, slugs, descriptions,          │
│                    tags, OG metadata, lang, word count)  │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                    RUNTIME (Browser)                     │
│                                                          │
│  Injected script (head-inline)                           │
│       │                                                  │
│       ├─ fetch('/_webmcp/manifest.json')                 │
│       │                                                  │
│       ├─ navigator.modelContext.provideContext()         │
│       │    ├─ search_content (manifest/pagefind/orama)   │
│       │    ├─ list_sections                              │
│       │    ├─ go_to (+ requestUserInteraction)           │
│       │    ├─ get_page_info (enhanced metadata)          │
│       │    └─ custom tools (user-defined)                │
│       │                                                  │
│       └─ scanDeclarativeForms() (if formScanning: true)  │
└──────────────────────────────────────────────────────────┘
```

---

## Browser Support

WebMCP is currently available behind a flag in Chrome 146+:

1. Open `chrome://flags#webmcp-for-testing`
2. Enable the flag
3. Restart Chrome

Native support (no flag required) is targeted for H2 2026. Microsoft Edge is actively collaborating.

---

## Security

This integration follows [Chrome Agent Security Guidelines](https://developer.chrome.com/docs/ai/webmcp/secure-tools):

- **readOnlyHint** on all non-mutating tools
- **untrustedContentHint** on tools returning page content
- **requestUserInteraction()** for state-mutating tools (`go_to` prompts user consent before navigating)
- **Output truncation** (default 1500 chars) prevents context overflow
- **Prompt injection sanitization** strips common instruction patterns
- **Cross-origin control** via `exposedTo` (default: same-origin only)

---

## Why FreshJuice?

This is a fork of the original [`astro-webmcp`](https://github.com/fabricioctelles/astro-webmcp) by [fabricioctelles](https://github.com/fabricioctelles), maintained by [FreshJuice](https://freshjuice.dev) with:

- **Fixed script injection** — uses `head-inline` stage for reliable delivery on Astro v6
- **Custom tools API** — expose your own domain-specific functionality declaratively in `astro.config.mjs`
- **Search backends** — Pagefind and Orama full-text search, with automatic fallback
- **Declarative form scanning** — auto-register annotated `<form>` elements as tools
- **Enhanced metadata** — tags, OpenGraph, canonical URL, language, word count in manifest
- **English docs & comments** — fully in English throughout

---

## Further Reading

- [Usage Guide](docs/usage.md) — detailed setup, testing, and troubleshooting
- [Architecture](docs/architecture.md) — design decisions and component breakdown
- [Changelog](CHANGELOG.md) — version history

---

## License

[MIT](LICENSE)
