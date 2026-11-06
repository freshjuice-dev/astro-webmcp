# @freshjuice/astro-webmcp

[![npm version](https://img.shields.io/npm/v/@freshjuice/astro-webmcp?color=orange)](https://www.npmjs.com/package/@freshjuice/astro-webmcp)
[![Astro](https://img.shields.io/badge/Astro-6_+_/_7+-ff5d01?logo=astro&logoColor=white)](https://astro.build/)
[![WebMCP](https://img.shields.io/badge/WebMCP-Chrome_149+-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/ai/webmcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Astro integration that exposes your site content via WebMCP for AI agents.** Make your Astro site AI-agent ready in one line of code.

---

## What is WebMCP?

WebMCP is an experimental browser API that lets websites expose structured tools for AI agents, such as searching articles, navigating to a page, or reading metadata. The community draft is not a W3C Standard, and Chrome's experimental features can differ from that draft.

- **Spec:** [https://webmachinelearning.github.io/webmcp/](https://webmachinelearning.github.io/webmcp/)
- **Chrome docs:** [https://developer.chrome.com/docs/ai/webmcp](https://developer.chrome.com/docs/ai/webmcp)
- **GitHub:** [https://github.com/webmachinelearning/webmcp](https://github.com/webmachinelearning/webmcp)

---

## Installation

```bash
npm install @freshjuice/astro-webmcp
```

## Basic usage

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import webmcp from '@freshjuice/astro-webmcp';

export default defineConfig({
  integrations: [webmcp()],
});
```

The integration exposes metadata for generated pages through WebMCP tools in supported browsers. Development uses a Home-only stub manifest; SSR middleware does not build a complete index of dynamic content.

---

## Configuration

```js
webmcp({
  // Filter which collections to expose (default: all)
  collections: ['blog', 'docs'],

  // Custom tools: expose your own domain-specific functionality
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
      executeBody: `return safeOutput(await fetch('/api/search?q=' + encodeURIComponent(params.query), { signal })
        .then(r => { if (!r.ok) throw new Error('Search failed'); return r.json(); }));`,
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
    sanitizeOutputs: true,  // heuristic output filtering (default: true)
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `string[]` | `undefined` (all) | List of collections to include in the manifest |
| `customTools` | `CustomTool[]` | `[]` | Domain-specific tools to register alongside built-in ones |
| `formScanning` | `boolean` | `false` | Auto-register `<form toolname="..." tooldescription="...">` elements as tools |
| `search.backend` | `'manifest' \| 'pagefind' \| 'orama'` | `'manifest'` | Search backend for `search_content` |
| `search.oramaIndexUrl` | `string` | Unset | URL of pre-built Orama index (required for `'orama'`) |
| `search.pagefindBundlePath` | `string` | `'/pagefind/'` | Compatibility option; load `window.pagefind` yourself |
| `security.exposedTo` | `string[]` | `[]` | Origins allowed to access tools cross-origin |
| `security.maxOutputLength` | `number` | `1500` | Character limit per tool output |
| `security.sanitizeOutputs` | `boolean` | `true` | Strip patterns that resemble prompt injection |

### Custom tools

The `customTools` array lets you expose your own site-specific functionality. Each tool needs:

- `name`: unique tool identifier (1-128 ASCII letters, digits, `_`, `-`, or `.`).
- `description`: natural language description for AI agents.
- `inputSchema`: JSON Schema for the tool's parameters; validate actual inputs in application code too.
- `executeBody`: async function body string, run in the browser with `params`, `safeOutput`, and the per-execution `signal`. Supports `await`; pass `signal` to `fetch()` for cancellation.
- `title`: optional human-readable display title.
- `annotations`: optional `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, and `debugging` hints. `readOnlyHint` defaults to `false`; declare `true` only for non-mutating tools. Chrome documents `debugging` from version 156.

`safeOutput()` returns the package's MCP-style `{ content: [{ type: 'text', text: '...' }] }` envelope. WebMCP permits JSON-serializable results and does not require this envelope. If you set `outputSchema`, match the actual returned structure (either the `safeOutput()` envelope or your raw object). Tool code is public browser code: keep secrets and authorization checks on the server.

### Search backends

`search_content` supports three backends, with automatic fallback to manifest search:

| Backend | Description | Requires |
|---------|-------------|----------|
| `manifest` (default) | Substring search on the generated manifest | A valid manifest |
| `pagefind` | Full-text search via Pagefind | `astro-pagefind` or `pagefind` on the page |
| `orama` | Full-text search via Orama | `@freshjuice/astro-search-plugin` or similar, with `oramaIndexUrl` |

### Declarative form scanning

`formScanning: true` enables the package's opt-in form scanner. It accepts Chrome's experimental [declarative attributes](https://developer.chrome.com/docs/ai/webmcp/declarative-api) and legacy attributes. Declarative forms were removed from the community draft in October 2026; this scanner is a compatibility extension, not a standards-compliant polyfill.

```html
<!-- Chrome experimental attributes -->
<form toolname="search_products" tooldescription="Search product catalog by keyword">
  <input name="query" type="text" required toolparamdescription="Search term">
  <button type="submit">Search</button>
</form>

<!-- legacy attributes (still works) -->
<form name="search_products" description="Search product catalog by keyword">
  <input name="query" type="text" required>
  <button type="submit">Search</button>
</form>
```

The scanner derives input schemas from fields and fills them when called. It calls `requestSubmit()` only for forms with `toolautosubmit`; otherwise the user submits the filled form. It skips experimental native form tools already discoverable in the current window. Use unique names across built-in, custom, and scanned tools, and test native registration timing in your target browser. Scanner submission does not wait for your server-side operation to finish.

---

## Registered tools

| Tool | Description |
|------|-------------|
| `search_content` | Search articles and pages by keyword (supports manifest, Pagefind, or Orama backends) |
| `list_sections` | List available content sections with item counts |
| `go_to` | Navigate to a specific page by slug; browser consent is not guaranteed |
| `get_page_info` | Get current page metadata (title, description, headings, language, word count, canonical URL) |
| *declarative forms* | Any `<form toolname="..." tooldescription="...">` (or legacy `name`/`description`) when `formScanning: true` |
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
│       ├─ document.modelContext.registerTool()            │
│       │    ├─ search_content (manifest/pagefind/orama)   │
│       │    ├─ list_sections                              │
│       │    ├─ go_to (navigation)                        │
│       │    ├─ get_page_info (enhanced metadata)          │
│       │    └─ custom tools (user-defined)                │
│       │                                                  │
│       └─ scanDeclarativeForms() (if formScanning: true)  │
└──────────────────────────────────────────────────────────┘
```

---

## Browser support

WebMCP is experimental and available through Chrome's testing flag or origin trial. Use HTTPS (localhost is suitable for development), feature-detect `document.modelContext`, and consult [Chrome Status](https://chromestatus.com/feature/5117755740913664) and the [trial page](https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241) for current platforms, versions, and expiry. A version number alone does not guarantee availability. The integration retains `navigator.modelContext` only for older previews.

### Development: Chrome flag

1. Open `chrome://flags#enable-webmcp-testing`
2. Enable the flag
3. Restart Chrome

### Production: origin trial

For production sites (no flag required for visitors), register for a Chrome Origin Trial token:

1. Go to https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241
2. Register your domain and get a token
3. Add the token to your site's `<head>`:

```html
<meta http-equiv="origin-trial" content="YOUR_TOKEN_HERE">
```

In Astro, add this to your base layout (`src/layouts/Layout.astro` or similar):

```astro
<meta http-equiv="origin-trial" content={import.meta.env.WEBMCP_ORIGIN_TRIAL_TOKEN}>
```

> You can manage the token in `.env` as `WEBMCP_ORIGIN_TRIAL_TOKEN=your-token`. The rendered token is public and origin-scoped, not a secret.

The trial is experimental deployment, not a stable-release commitment. Check the live trial requirements before shipping.

---

## Security

Read Chrome's [tool security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools) before exposing application actions.

- Annotations describe behavior; they are not authorization or consent controls. Validate inputs and permissions in application code, and implement site-owned confirmation for consequential actions.
- `requestUserInteraction()` is not in the current ModelContext IDL. `go_to` uses it only if present for compatibility and otherwise navigates without that prompt.
- Output truncation limits text size (default 1500 characters). The regexp sanitizer is a heuristic, not a prompt-injection security boundary.
- Cross-origin access requires secure origins in the provider's `exposedTo` and the caller's `getTools({ fromOrigins: [...] })`. Cross-origin frames also need `allow="tools"`; exposure alone does not delegate registration permission.

See the [usage guide](docs/usage.md#testing-locally) for automated tests, native-browser smoke checks, cancellation, and evaluation guidance.

---

## Why FreshJuice?

This is a fork of the original [`astro-webmcp`](https://github.com/fabricioctelles/astro-webmcp) by [fabricioctelles](https://github.com/fabricioctelles), maintained by [Alex Zappa](https://alex.zappa.dev/) at [FreshJuice](https://freshjuice.dev) with:

- Script injection through the `head-inline` stage on Astro v6 and v7
- Custom tools configured in `astro.config.mjs`
- Pagefind and Orama full-text search, with manifest fallback
- Opt-in registration of annotated forms
- Tags, OpenGraph, canonical URL, language, and word count in the manifest
- English documentation and comments

---

## Further reading

- [Usage guide](docs/usage.md): detailed setup, testing, and troubleshooting
- [Architecture](docs/architecture.md): design decisions and component breakdown
- [Changelog](CHANGELOG.md): version history

---

## License

[MIT](LICENSE)
