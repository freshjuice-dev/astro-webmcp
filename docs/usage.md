# Usage Guide — @freshjuice/astro-webmcp

## Installation

```bash
npm install @freshjuice/astro-webmcp
```

## Minimal Setup

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import webmcp from '@freshjuice/astro-webmcp';

export default defineConfig({
  integrations: [webmcp()],
});
```

This exposes all site content via WebMCP automatically.

## Configuration Options

```js
webmcp({
  // Filter which collections to expose (default: all)
  collections: ['blog', 'docs'],

  // Custom domain-specific tools
  customTools: [
    {
      name: 'search_tracker',
      description: 'Search the tracker database by cookie name or domain.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Cookie name or domain' },
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

  // Search backend for search_content
  search: {
    backend: 'pagefind',       // 'manifest' | 'pagefind' | 'orama'
    oramaIndexUrl: '/search-index.json',  // required for 'orama'
    pagefindBundlePath: '/pagefind/',     // default for 'pagefind'
  },

  security: {
    exposedTo: [],
    maxOutputLength: 1500,
    sanitizeOutputs: true,
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `string[]` | `undefined` (all) | Collections to include in the manifest |
| `customTools` | `CustomTool[]` | `[]` | Domain-specific tools to register |
| `formScanning` | `boolean` | `false` | Auto-register `<form name="..." description="...">` elements as tools |
| `search.backend` | `'manifest' \| 'pagefind' \| 'orama'` | `'manifest'` | Search backend for `search_content` |
| `search.oramaIndexUrl` | `string` | — | URL of pre-built Orama index (required for `'orama'`) |
| `search.pagefindBundlePath` | `string` | `'/pagefind/'` | Pagefind bundle path |
| `security.exposedTo` | `string[]` | `[]` | Origins allowed cross-origin access |
| `security.maxOutputLength` | `number` | `1500` | Max chars per tool output |
| `security.sanitizeOutputs` | `boolean` | `true` | Strip prompt injection patterns |

### Custom Tools

Each custom tool requires:

- `name` — unique identifier
- `description` — natural language description for AI agents
- `inputSchema` — JSON Schema for parameters
- `executeBody` — function body string (runs in browser). Receives `params` and `safeOutput`. Return data or a Promise.
- `annotations` — optional security hints

**Example — expose a contact form:**

```js
customTools: [{
  name: 'submit_contact',
  description: 'Submit a contact form with name, email, and message.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      message: { type: 'string' },
    },
    required: ['name', 'email', 'message'],
  },
  executeBody: `
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return safeOutput({ error: 'Failed to submit' });
    return safeOutput(await res.json());
  `,
  annotations: { readOnlyHint: false },
}]
```

### Search Backends

`search_content` supports three backends, with automatic fallback to manifest search:

| Backend | Description | Requires |
|---------|-------------|----------|
| `manifest` (default) | Substring search on the generated manifest | Nothing — always works |
| `pagefind` | Full-text search via Pagefind | `astro-pagefind` or `pagefind` on the page |
| `orama` | Full-text search via Orama | `@freshjuice/astro-search-plugin` or similar, with `oramaIndexUrl` |

**Pagefind example:**

```js
// astro.config.mjs
import pagefind from 'astro-pagefind';
import webmcp from '@freshjuice/astro-webmcp';

export default defineConfig({
  integrations: [
    pagefind(),
    webmcp({ search: { backend: 'pagefind' } }),
  ],
});
```

**Orama example (with @freshjuice/astro-search-plugin):**

```js
// astro.config.mjs
import webmcp from '@freshjuice/astro-webmcp';

export default defineConfig({
  integrations: [
    webmcp({
      search: {
        backend: 'orama',
        oramaIndexUrl: '/search-index.json',
      },
    }),
  ],
});
```

### Declarative Form Scanning

When `formScanning: true`, any `<form>` element with `name` and `description` attributes is auto-registered as a WebMCP tool. The integration builds the input schema from form fields and submits the form when the agent calls it.

```html
<form name="search_products" description="Search product catalog by keyword">
  <input name="query" type="text" required>
  <button type="submit">Search</button>
</form>
```

This implements the spec's declarative API — no JS required. The agent sees these forms as callable tools alongside the built-in ones.

## How It Works in the Browser

After build, every page includes a lightweight script (~3KB) that:

1. Checks if the browser supports WebMCP (`'modelContext' in navigator`)
2. If not supported, exits immediately — zero impact
3. If supported, loads `/_webmcp/manifest.json` and registers tools via `provideContext()` (batch) or `registerTool()` (individual)

### Built-in Tools

#### `search_content`

Search site content by keyword. Uses the configured backend (manifest, Pagefind, or Orama) with automatic fallback.

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

**Agent example:** "Search for articles about TypeScript in the blog"

#### `list_sections`

List available content sections/collections.

```json
{
  "name": "list_sections",
  "inputSchema": { "type": "object", "properties": {} }
}
```

**Agent example:** "What content sections does this site have?"

#### `go_to`

Navigate to a specific page. **Prompts user consent** via `requestUserInteraction()` before redirecting — per Chrome Agent Security Guidelines for state-mutating tools.

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

**Agent example:** "Open the article about WebMCP"

#### `get_page_info`

Get metadata about the current page.

```json
{
  "name": "get_page_info",
  "inputSchema": { "type": "object", "properties": {} }
}
```

Returns `{ title, description, headings, url, lang, canonical, wordCount }`.

## Testing Locally

### 1. Enable WebMCP in Chrome

Navigate to `chrome://flags#webmcp-for-testing` → **Enabled** → Relaunch.

### 2. Install the test extension

[Model Context Tool Inspector](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd)

### 3. Verify tools in DevTools

Open DevTools → Console:

```js
const tools = await navigator.modelContext.getTools();
console.log(tools);
// [{name: "search_content", ...}, {name: "list_sections", ...}, ...]
```

### 4. Test a tool manually

```js
const tools = await navigator.modelContext.getTools();
const searchTool = tools.find(t => t.name === 'search_content');
const result = await navigator.modelContext.executeTool(searchTool, '{"query": "astro"}');
console.log(result);
```

## Declarative Forms (Alternative to customTools)

For simple forms, you can use the declarative approach instead of `customTools`. When `formScanning: true`, annotated forms are auto-registered:

```astro
---
// src/pages/contact.astro
---
<form name="send_message"
      description="Send a contact message."
      action="/api/contact">
  <label for="email">Email</label>
  <input type="email" name="email" required>

  <label for="message">Message</label>
  <textarea name="message" required></textarea>

  <button type="submit">Send</button>
</form>
```

The agent will see **both** the integration tools + the declarative form tools + any custom tools.

## Generated Manifest

After build, `dist/_webmcp/manifest.json` contains:

```json
{
  "collections": [
    { "name": "blog", "count": 12 },
    { "name": "docs", "count": 8 }
  ],
  "entries": [
    {
      "slug": "blog/introducing-webmcp",
      "url": "/blog/introducing-webmcp/",
      "title": "Introducing WebMCP",
      "description": "How to expose content for AI agents",
      "collection": "blog",
      "tags": ["webmcp", "ai"],
      "ogTitle": "Introducing WebMCP — FreshJuice Blog",
      "ogDescription": "A comprehensive guide to WebMCP for Astro sites",
      "canonical": "https://mysite.com/blog/introducing-webmcp/",
      "lang": "en",
      "wordCount": 1200
    }
  ]
}
```

## Compatibility

| Browser | Support |
|---------|---------|
| Chrome 149+ | ✅ (flag or origin trial) |
| Other browsers | ❌ (script doesn't execute, zero impact) |

The integration is a **progressive enhancement** — sites work normally in browsers without WebMCP support.

## Troubleshooting

### Tools don't appear

1. Verify `chrome://flags#webmcp-for-testing` is enabled
2. Check Network tab — `/_webmcp/manifest.json` should return 200
3. In Console, check `'modelContext' in navigator` → should be `true`

### Empty manifest

- Confirm the build completed without errors
- Verify your Content Collections are defined in `src/content/config.ts`

### Search returns no results

- Search is case-insensitive on `title`, `description`, and `tags` fields
- If using `pagefind` or `orama` backend, verify the search index is available on the page
- The integration automatically falls back to manifest search if the configured backend fails

### Pagefind/Orama search not working

- For `pagefind`: verify `astro-pagefind` is installed and the Pagefind bundle is at the configured path
- For `orama`: verify `oramaIndexUrl` points to a valid pre-built Orama index JSON file
- Check browser console for `[astro-webmcp]` warnings — they indicate backend failures with automatic fallback
