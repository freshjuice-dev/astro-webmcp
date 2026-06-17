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

## How It Works in the Browser

After build, every page includes a lightweight script (~1.5KB) that:

1. Checks if the browser supports WebMCP (`'modelContext' in navigator`)
2. If not supported, exits immediately — zero impact
3. If supported, loads `/_webmcp/manifest.json` and registers tools

### Built-in Tools

#### `search_content`

Search site content by keyword.

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

Navigate to a specific page.

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

Returns `{ title, description, headings, url }`.

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

## Combining with Declarative API

The integration uses the Imperative API for search and navigation. For existing forms on your site, you can add the Declarative API manually — both coexist:

```astro
---
// src/pages/contact.astro
---
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

The agent will see **both** the integration tools + the declarative form tools.

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
      "tags": ["webmcp", "ai"]
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
- If frontmatter has no `description`, search only matches on `title`
