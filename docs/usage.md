# Usage guide: @freshjuice/astro-webmcp

## Installation

```bash
npm install @freshjuice/astro-webmcp
```

## Minimal setup

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import webmcp from '@freshjuice/astro-webmcp';

export default defineConfig({
  integrations: [webmcp()],
});
```

This exposes metadata for generated pages through WebMCP tools. Development serves a Home-only stub manifest. SSR middleware does not index all dynamic routes or content; verify the deployed manifest rather than assuming complete coverage.

## Configuration options

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
      executeBody: `return safeOutput(await fetch('/api/search?q=' + encodeURIComponent(params.query), { signal })
        .then(r => { if (!r.ok) throw new Error('Search failed'); return r.json(); }));`,
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
| `formScanning` | `boolean` | `false` | Auto-register `<form toolname="..." tooldescription="...">` elements as tools |
| `search.backend` | `'manifest' \| 'pagefind' \| 'orama'` | `'manifest'` | Search backend for `search_content` |
| `search.oramaIndexUrl` | `string` | Unset | URL of pre-built Orama index (required for `'orama'`) |
| `search.pagefindBundlePath` | `string` | `'/pagefind/'` | Compatibility option; load `window.pagefind` yourself |
| `security.exposedTo` | `string[]` | `[]` | Origins allowed cross-origin access |
| `security.maxOutputLength` | `number` | `1500` | Max chars per tool output |
| `security.sanitizeOutputs` | `boolean` | `true` | Heuristic regexp filtering, not a security boundary |

### Custom tools

Each custom tool requires:

- `name`: unique identifier (1-128 ASCII letters, digits, `_`, `-`, or `.`).
- `description`: natural language description for AI agents.
- `inputSchema`: JSON Schema for parameters; enforce validation in application code too.
- `executeBody`: async function body string, run in the browser with `params`, `safeOutput`, and per-execution `signal`. Supports `await`; pass `signal` to cancellable operations.
- `title`: optional human-readable display title.
- `annotations`: optional `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, and `debugging`. All default to `false`; Chrome documents `debugging` from version 156. Declare `readOnlyHint: true` explicitly for read-only custom tools.

The native callback is `execute(params, { signal })`; the package exposes that per-call signal as the `signal` variable in `executeBody`. It is separate from the registration-lifetime signal. Aborting registration unregisters a tool, not its in-flight executions in the current API.

`safeOutput(data)` serializes, filters, and truncates data in the package's `{ content: [{ type: 'text', text: '...' }] }` envelope. That is a package convention, not a required WebMCP response format. Truncated text might not be valid JSON. `outputSchema` is compatibility metadata and is not supported by the current WebMCP IDL.

Treat `executeBody` as trusted application code, never user input. It is serialized to the browser, cannot close over your config's variables, and must not contain secrets. Dynamic compilation also needs a compatible Content Security Policy; test your site's policy rather than weakening it without review.

**Example: prepare a contact message for human review:**

```js
customTools: [{
  name: 'prepare_contact',
  title: 'Prepare contact message',
  description: 'Fill the contact form for the user to review and submit.',
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
    signal.throwIfAborted();
    const form = document.querySelector('#contact');
    if (!form) return safeOutput({ error: 'Contact form is unavailable' });
    for (const key of ['name', 'email', 'message']) {
      if (typeof params[key] !== 'string') throw new Error('Expected text for ' + key);
      const field = form.elements.namedItem(key);
      if (!field || !('value' in field)) throw new Error('Missing field: ' + key);
      field.value = params[key];
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return safeOutput({ prepared: true, submitted: false });
  `,
  annotations: { readOnlyHint: false },
}]
```

Use a visible form with `id="contact"` and matching field names. The user submits it through your normal application flow. For tools that send messages or commit other consequential changes directly, implement site-owned confirmation and server-side validation, authentication, authorization, and replay protection. `consequentialHint: true` describes the action but does not implement those controls.

### Search backends

`search_content` supports three backends, with automatic fallback to manifest search:

| Backend | Description | Requires |
|---------|-------------|----------|
| `manifest` (default) | Substring search on the generated manifest | A valid manifest |
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

### Declarative form scanning

`formScanning: true` enables a package extension that derives tool schemas from annotated forms. It supports Chrome's experimental [Declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api) attributes and legacy attributes. Declarative forms were removed from the community draft in October 2026; the scanner is not a complete native Declarative API polyfill.

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

The scanner fills fields and calls `requestSubmit()` only when `toolautosubmit` is present; otherwise it leaves submission to the user. It skips experimental native form tools already discoverable in the current window. Use unique names across all tools and test native registration timing in the intended browser. A duplicate or rejected registration causes batch rollback rather than leaving a partial tool surface. Scanner submission dispatches the normal form flow; it does not wait for server-side completion or implement native `respondWith()` behavior.

#### Styling agent-active forms

When an agent fills a natively-registered form, Chrome applies pseudo-classes you can style ([Declarative API docs](https://developer.chrome.com/docs/ai/webmcp/declarative-api#modify_focus_indicator)):

- `:tool-form-active`: on the `<form>` while the agent is working on it
- `:tool-submit-active`: on the submit button

```css
form:tool-form-active {
  outline: 2px dashed blue;
}
```

These are experimental native Chrome styles, not scanner behavior. Scanner-filled forms do not gain native active-state styling from the package.

## How it works in the browser

Every page includes an injected script that:

- Uses `document.modelContext`, with `navigator.modelContext` only as a legacy preview fallback, and exits if registration is unavailable.
- Loads `/_webmcp/manifest.json` and prepares built-in, custom, and opted-in form tools.
- Awaits each `registerTool()` call in sequence. The method returns `Promise<void>`, not an unregister handle. If any tool fails to compile or register, the integration aborts the shared registration controller to roll back the batch. This is rollback behavior, not a native atomic batch API.
- Cleans up the old registration before initializing after Astro page transitions, and discards stale initialization work.

`provideContext()` is absent from the current API. Unsupported browsers still load the injected script but skip tool registration and manifest fetching.

### Built-in tools

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

Navigate to a manifest page. `requestUserInteraction()` is a feature-detected compatibility hook, not a member of the current ModelContext IDL. If absent, navigation proceeds without its prompt. Do not use `go_to` as a consent boundary for consequential workflows.

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

## Testing locally

For package development, run:

```bash
npm test
```

This builds the package and runs `node --test tests/*.test.mjs`. Mocked API tests do not establish native Chrome compatibility. Use a built Astro site and its preview server for the following manual smoke test; dev mode has only a stub manifest.

### 1. Enable WebMCP in Chrome

Use HTTPS or localhost. Navigate to `chrome://flags#enable-webmcp-testing`, enable it, and relaunch. Check [Chrome Status](https://chromestatus.com/feature/5117755740913664) for supported versions and platforms; a version number alone does not guarantee support.

### 2. Install the test extension

[Model Context Tool Inspector](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd)

### 3. Verify tools in DevTools

Open DevTools → Console:

```js
const mc = document.modelContext;
if (!mc?.getTools) throw new Error('WebMCP is unavailable in this context');
const tools = await mc.getTools();
console.log(tools);
// [{name: "search_content", ...}, {name: "list_sections", ...}, ...]
```

### 4. Test a tool manually

```js
const searchTool = (await mc.getTools()).find(t => t.name === 'search_content');
if (!searchTool) throw new Error('Search tool is not registered');
const result = await mc.executeTool(searchTool, { query: 'astro' });
console.log(result);
```

Pass the discovered descriptor and a JavaScript object, not a JSON string. Results may be serialized strings; navigation can return `null` in Chrome.

### 5. Check lifecycle, cancellation, and failures

```js
for (const type of ['toolchange', 'toolactivated', 'toolcancel']) {
  mc.addEventListener(type, event => console.log(type, event.toolName));
}
```

`toolchange` reports discovery changes; activation and cancellation events identify the tool on the owning model context. Check event support in your pinned browser.

- Navigate using Astro View Transitions, then discover tools again. Confirm tools target the new page without stale or duplicate registrations.
- In a disposable test site, introduce a duplicate name, invalid custom body, or rejected registration. Confirm rollback removes the integration's whole batch, including opted-in scanned forms.
- Run a slow custom fetch tool with a new `AbortController()` and `mc.executeTool(descriptor, {}, { signal: controller.signal })`, then abort it. Confirm its per-call signal cancels the fetch. Separately verify that unregistering does not abort a running call on current Chrome.
- Test unsupported browsers, missing or malformed manifests, failed search backends, and native form registration with scanning both off and on.

### Evaluate application behavior

Record package version, exact Chrome build and flags/trial, spec revision, agent/model version, and fixture state with each evaluation. Test realistic user requests for tool selection, parameter extraction, result usefulness, and successful next steps, not just schema acceptance.

Reuse the application's validation and permission service for the UI and tools. Test malformed input, unauthorized users, stale resource versions, retries, and rate limits. A valid schema does not prove an operation is authorized. Recompute consequential actions at confirmation and reject stale plans. Define the irreversible commit point: abort before it must prevent the change; abort after it may not undo a completed server action. Report success only after committed state and the UI agree, and verify actual server state after cancellation.

### Cross-origin smoke test

The provider must list the caller's secure origin in `security.exposedTo`. The caller must opt in with `mc.getTools({ fromOrigins: ['https://provider.example'] })`, and cross-origin iframes need `allow="tools"`. Verify access is denied when either origin opt-in or required permissions delegation is missing. This works within the supported frame tree, not as a remote MCP endpoint.

## Declarative forms (alternative to customTools)

For simple forms, you can use the declarative approach instead of `customTools`. When `formScanning: true`, annotated forms are auto-registered:

```astro
---
// src/pages/contact.astro
---
<form toolname="send_message"
      tooldescription="Send a contact message."
      action="/api/contact">
  <label for="email">Email</label>
  <input id="email" type="email" name="email" required>

  <label for="message">Message</label>
  <textarea id="message" name="message" required></textarea>

  <button type="submit">Send</button>
</form>
```

With scanning enabled and registration successful, the agent sees the built-in, scanned, and custom tools. This example fills fields for review without automatically submitting them.

## Generated manifest

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
      "ogTitle": "Introducing WebMCP: FreshJuice Blog",
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
| Chrome experimental builds | Testing flag or eligible origin trial; feature detection required |
| Browsers without `modelContext.registerTool` | Injected script exits without registering tools |

The integration is a progressive enhancement. Use secure contexts and consult [Chrome Status](https://chromestatus.com/feature/5117755740913664) for current platform and version availability. The community draft is not a W3C Standard.

### Origin trial setup (production)

To use WebMCP in production without requiring visitors to toggle a flag, register for a Chrome Origin Trial:

1. Visit https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241
2. Click **Register** and fill in your domain and usage details
3. Copy the generated token
4. Add the `<meta>` tag to your base layout:

```astro
<!-- src/layouts/Layout.astro -->
<meta http-equiv="origin-trial" content={import.meta.env.WEBMCP_ORIGIN_TRIAL_TOKEN}>
```

Store the token in `.env`:

```bash
WEBMCP_ORIGIN_TRIAL_TOKEN=AhbW+...your-token-here...
```

The token is origin-scoped and expires. Check its validity, eligible Chrome versions, platforms, and expiry on the live trial page. Trial availability is not a stable-release commitment.

## Troubleshooting

### Tools don't appear

- Verify `chrome://flags#enable-webmcp-testing` is enabled (dev) or your origin trial `<meta>` tag is present (production).
- Check the Network tab: `/_webmcp/manifest.json` should return HTTP 200 with valid manifest JSON.
- In Console, check `document.modelContext?.registerTool` and `window.isSecureContext`.
- Check `[astro-webmcp]` warnings for compilation, duplicate-name, or asynchronous registration failures; a failure rolls back the integration's whole batch.

### Origin trial token not working

- Verify the token matches your registered origin.
- Check the expiry on the trial page.
- Confirm the `<meta>` tag appears in the rendered page source using View Source.
- Put the `<meta>` tag in the initial HTML rather than injecting it with JavaScript.

### Empty manifest

- Confirm the build completed successfully.
- Inspect generated pages and the `collections` path filter; manifest sections come from URL path segments, not directly from Content Collection definitions.
- Development serves a stub, and SSR middleware does not provide a full dynamic content index.

### Search returns no results

- Search is case-insensitive on `title`, `description`, and `tags` fields
- If using `pagefind` or `orama` backend, verify the search index is available on the page
- The integration automatically falls back to manifest search if the configured backend fails

### Pagefind/Orama search not working

- For `pagefind`: load the bundle into `window.pagefind`; `pagefindBundlePath` is retained for compatibility but does not load the bundle
- For `orama`: verify `oramaIndexUrl` points to a valid pre-built Orama index JSON file
- Check the browser console for `[astro-webmcp]` backend-failure warnings

## Developer references

- [Get started and current requirements](https://developer.chrome.com/docs/ai/webmcp)
- [Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Experimental Declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api)
- [Build effective tools](https://developer.chrome.com/docs/ai/webmcp/build-tools)
- [Tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [Best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
- [Evaluations](https://developer.chrome.com/docs/ai/webmcp/evals)
- [Community draft and current IDL](https://webmachinelearning.github.io/webmcp/)
