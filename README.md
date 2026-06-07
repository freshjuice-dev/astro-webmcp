# astro-webmcp

Astro integration that automatically exposes your site's content via [WebMCP](https://developer.chrome.com/docs/ai/webmcp) — allowing AI agents to discover, search, and navigate your content directly in the browser.

## What is WebMCP?

WebMCP is a proposed web standard by Chrome that lets websites declare structured "tools" for AI agents. Instead of an agent visually interpreting each page element, the site explicitly declares what can be done — search articles, navigate to sections, get page metadata.

- **Spec:** https://webmachinelearning.github.io/webmcp/
- **Chrome docs:** https://developer.chrome.com/docs/ai/webmcp
- **GitHub:** https://github.com/webmachinelearning/webmcp

## What this plugin does

1. **At build time**: reads your Astro pages and generates a JSON manifest with metadata (title, slug, description)
2. **In the browser**: injects a lightweight script (~1KB) that registers WebMCP tools via `document.modelContext.registerTool()`
3. **Agents** visiting any page automatically discover tools to search and navigate your content

### Registered tools

| Tool | Description |
|------|-------------|
| `search_content` | Search articles and pages by keyword |
| `list_sections` | List available content sections with item counts |
| `go_to` | Navigate to a specific page by slug |
| `get_page_info` | Get current page metadata (title, description, headings) |

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

With options:

```js
webmcp({
  collections: ['blog', 'docs'], // filter collections (default: all)
})
```

## Requirements

- Astro 6+
- Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled (or origin trial)
- Origin-isolated document (Astro default)

## Testing

Install the [Model Context Tool Inspector](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd) extension to simulate an agent calling your tools.

Verify in DevTools console:

```js
const tools = await document.modelContext.getTools();
console.log(tools);
```

## How it works

The integration uses two Astro hooks:

- **`astro:config:setup`** — injects the client-side script into every page via `injectScript`
- **`astro:build:done`** — generates `/_webmcp/manifest.json` by extracting titles and descriptions from built HTML files

The client script performs feature detection (`'modelContext' in document`) and exits immediately on unsupported browsers — zero performance impact.

## Documentation

- [Architecture](docs/architecture.md)
- [Usage guide](docs/usage.md)
- [Publishing to npm](docs/publishing.md)

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

## Status

🚧 Early development — WebMCP is an evolving standard (developer trial in Chrome 149+).

## License

MIT
