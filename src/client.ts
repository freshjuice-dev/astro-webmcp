/**
 * Client-side script injected into every page.
 * Loads the manifest and registers WebMCP tools via navigator.modelContext.
 *
 * Security applied per Chrome Agent Security Guidelines:
 * - readOnlyHint on all non-mutating tools
 * - untrustedContentHint on tools returning page content
 * - Output character limit (prevents context overflow)
 * - Sanitization against indirect prompt injection
 * - exposedTo for cross-origin control
 *
 * @see https://developer.chrome.com/docs/ai/webmcp/secure-tools
 * @see https://developer.chrome.com/docs/agents/security
 */

interface ManifestEntry {
  slug: string;
  url: string;
  title: string;
  description?: string;
  collection?: string;
  tags?: string[];
}

interface Manifest {
  collections: Array<{ name: string; count: number }>;
  entries: ManifestEntry[];
}

/** Config injected by the integration via __WEBMCP_CONFIG__ */
interface WebMCPClientConfig {
  exposedTo?: string[];
  maxOutputLength: number;
  sanitizeOutputs: boolean;
  customTools?: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    executeBody: string;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  }>;
}

// Config is replaced at build time by the integration
const CONFIG: WebMCPClientConfig = (globalThis as any).__WEBMCP_CONFIG__ ?? {
  maxOutputLength: 1500,
  sanitizeOutputs: true,
};

/**
 * Truncates output to the character limit.
 * Prevents context window overflow in the agent (deterministic guardrail).
 */
function truncateOutput(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 13) + '...[truncated]';
}

/**
 * Sanitizes content to mitigate indirect prompt injection.
 * Strips common instruction patterns embedded in content.
 */
function sanitize(text: string): string {
  if (!CONFIG.sanitizeOutputs) return text;
  return text
    // Strip "ignore previous instructions" patterns
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, '[filtered]')
    // Strip role-play / system prompt injection attempts
    .replace(/you\s+are\s+(now|a)\s+/gi, '[filtered]')
    .replace(/(system|assistant|user)\s*:\s*/gi, '[filtered]')
    // Strip instruction markers
    .replace(/<\/?(?:system|instruction|prompt|command)[^>]*>/gi, '[filtered]');
}

/**
 * Wraps output with sanitization and truncation.
 */
function safeOutput(data: unknown): string {
  let str = JSON.stringify(data);
  str = sanitize(str);
  return truncateOutput(str, CONFIG.maxOutputLength);
}

(async () => {
  const mc = (document as any).modelContext ?? (navigator as any).modelContext;
  if (!mc?.registerTool) return;

  let manifest: Manifest;
  try {
    const res = await fetch('/_webmcp/manifest.json');
    if (!res.ok) return;
    manifest = await res.json();
  } catch {
    return;
  }

  // Shared registration options (exposedTo for cross-origin control)
  const registerOptions = CONFIG.exposedTo?.length
    ? { exposedTo: CONFIG.exposedTo }
    : undefined;

  // Tool: search content
  mc.registerTool({
    name: 'search_content',
    description: 'Search articles and pages on this site by keyword. Returns title, URL, and description of matching results.',
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true, // Content comes from pages that may have UGC
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
        collection: { type: 'string', description: 'Filter by collection name (optional)' },
        limit: { type: 'number', description: 'Max results to return (default: 5)' },
      },
      required: ['query'],
    },
    execute: async (args: { query: string; collection?: string; limit?: number }) => {
      const q = args.query.toLowerCase();
      const limit = Math.min(args.limit ?? 5, 20); // Cap max results
      let results = manifest.entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q) ||
          (e.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
      if (args.collection) {
        results = results.filter((e) => e.collection === args.collection);
      }
      return safeOutput(results.slice(0, limit));
    },
  }, registerOptions);

  // Tool: list collections / sections
  mc.registerTool({
    name: 'list_sections',
    description: 'List all content sections (collections) available on this site with item counts.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: { type: 'object', properties: {} },
    execute: async () => safeOutput(manifest.collections),
  }, registerOptions);

  // Tool: navigate to content
  mc.registerTool({
    name: 'go_to',
    description: 'Navigate to a specific page on this site by its slug.',
    annotations: {
      readOnlyHint: false, // Mutates state (navigation)
    },
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Page slug or path' },
      },
      required: ['slug'],
    },
    execute: async (args: { slug: string }) => {
      const entry = manifest.entries.find(
        (e) => e.slug === args.slug || e.url === args.slug || e.url === `/${args.slug}/`,
      );
      if (entry) {
        window.location.href = entry.url;
        return null;
      }
      return 'Page not found. Use search_content to find available pages.';
    },
  }, registerOptions);

  // Tool: get current page info
  mc.registerTool({
    name: 'get_page_info',
    description: 'Get metadata about the current page (title, description, headings).',
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true, // DOM may contain UGC (comments, etc.)
    },
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const title = document.title;
      const description =
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map((h) => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim() ?? '',
      }));
      return safeOutput({ title, description, headings, url: window.location.pathname });
    },
  }, registerOptions);

  // ---- Custom tools (user-defined via astro.config) ---------------------------
  if (CONFIG.customTools?.length) {
    for (const tool of CONFIG.customTools) {
      try {
        // eslint-disable-next-line no-new-func
        const executeFn = new Function('params', 'safeOutput', tool.executeBody) as (
          params: Record<string, unknown>,
          so: (data: unknown) => string,
        ) => unknown;
        mc.registerTool(
          {
            name: tool.name,
            description: tool.description,
            annotations: tool.annotations ?? { readOnlyHint: true },
            inputSchema: tool.inputSchema,
            execute: async (params: Record<string, unknown>) => {
              const result = executeFn(params, safeOutput);
              return result instanceof Promise ? await result : result;
            },
          },
          registerOptions,
        );
      } catch (err) {
        console.warn(`[astro-webmcp] Failed to register custom tool "${tool.name}":`, err);
      }
    }
  }
})();
