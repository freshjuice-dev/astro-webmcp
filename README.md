# @freshjuice/astro-webmcp

[![npm version](https://img.shields.io/npm/v/@freshjuice/astro-webmcp?color=orange)](https://www.npmjs.com/package/@freshjuice/astro-webmcp)
[![Astro](https://img.shields.io/badge/Astro-6+-ff5d01?logo=astro&logoColor=white)](https://astro.build/)
[![WebMCP](https://img.shields.io/badge/WebMCP-Chrome_149+-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/ai/webmcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Astro integration that exposes your site content via WebMCP for AI agents.** Make your Astro site AI-agent ready in one line of code.

Built and maintained by [FreshJuice](https://freshjuice.dev) — a developer studio shipping lean tools since 2019.

> **Based on** [`astro-webmcp`](https://github.com/fabricioctelles/astro-webmcp) by [fabricioctelles](https://github.com/fabricioctelles) — the original Astro WebMCP integration. Forked with gratitude.

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

---

## Registered Tools

| Tool | Description |
|------|-------------|
| `search_content` | Search articles and pages by keyword |
| `list_sections` | List available content sections with item counts |
| `go_to` | Navigate to a specific page by slug |
| `get_page_info` | Get current page metadata (title, description, headings) |
| *your custom tools* | Whatever you define via `customTools` |

---

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
│  Injected script (head-inline)                          │
│       │                                                 │
│       ├─ fetch('/_webmcp/manifest.json')                │
│       │                                                 │
│       └─ navigator.modelContext.registerTool()          │
│            ├─ search_content                            │
│            ├─ list_sections                             │
│            ├─ go_to                                     │
│            ├─ get_page_info                             │
│            └─ custom tools (user-defined)                │
└─────────────────────────────────────────────────────────┘
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
- **Output truncation** (default 1500 chars) prevents context overflow
- **Prompt injection sanitization** strips common instruction patterns
- **Cross-origin control** via `exposedTo` (default: same-origin only)

---

## Why FreshJuice?

This is a fork of the original [`astro-webmcp`](https://github.com/fabricioctelles/astro-webmcp) by [fabricioctelles](https://github.com/fabricioctelles), maintained by [FreshJuice](https://freshjuice.dev) with:

- **Fixed script injection** — uses `head-inline` stage for reliable delivery on Astro v6
- **Custom tools API** — expose your own domain-specific functionality
- **English docs & comments** — fully in English throughout

---

## License

MIT — same as the original. Fork it, ship it, improve it.
