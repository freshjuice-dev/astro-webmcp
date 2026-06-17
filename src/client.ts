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
 * - requestUserInteraction() for state-mutating tools (go_to)
 *
 * @see https://developer.chrome.com/docs/ai/webmcp/secure-tools
 * @see https://developer.chrome.com/docs/agents/security
 */

// Types mirror src/types.ts — kept inline for the injected script (no module system).
interface ManifestEntry {
  slug: string;
  url: string;
  title: string;
  description?: string;
  collection?: string;
  tags?: string[];
  ogTitle?: string;
  ogDescription?: string;
  canonical?: string;
  lang?: string;
  wordCount?: number;
}

interface Manifest {
  collections: Array<{ name: string; count: number }>;
  entries: ManifestEntry[];
}

interface SearchConfig {
  backend: 'manifest' | 'pagefind' | 'orama';
  oramaIndexUrl?: string;
  pagefindBundlePath?: string;
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
  formScanning?: boolean;
  search?: SearchConfig;
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

// =============================================================================
// Search backends
// =============================================================================

/** Manifest-based substring search (default, always works). */
function searchManifest(
  manifest: Manifest,
  query: string,
  collection?: string,
  limit = 5,
): ManifestEntry[] {
  const q = query.toLowerCase();
  let results = manifest.entries.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      (e.description ?? '').toLowerCase().includes(q) ||
      (e.tags ?? []).some((t) => t.toLowerCase().includes(q)),
  );
  if (collection) {
    results = results.filter((e) => e.collection === collection);
  }
  return results.slice(0, Math.min(limit, 20));
}

/** Pagefind-based full-text search (requires pagefind loaded on the page). */
async function searchPagefind(
  query: string,
  limit = 5,
): Promise<ManifestEntry[]> {
  const pf = (window as any).pagefind;
  if (!pf) {
    console.warn('[astro-webmcp] pagefind not found on window — falling back to manifest search');
    return [];
  }
  try {
    const search = await pf.search(query);
    const results = search.results.slice(0, limit);
    return results.map((r: any) => ({
      slug: r.url?.replace(/\/$/, '') || r.meta?.url || '',
      url: r.url || r.meta?.url || '',
      title: r.meta?.title || r.data?.title || '',
      description: r.excerpt || r.meta?.description || '',
    }));
  } catch (err) {
    console.warn('[astro-webmcp] Pagefind search failed:', err);
    return [];
  }
}

/** Orama-based full-text search (requires @orama/orama loaded on the page). */
async function searchOrama(
  query: string,
  limit = 5,
): Promise<ManifestEntry[]> {
  const oramaIndexUrl = CONFIG.search?.oramaIndexUrl;
  if (!oramaIndexUrl) {
    console.warn('[astro-webmcp] oramaIndexUrl not configured — falling back to manifest search');
    return [];
  }
  try {
    // Dynamic import of @orama/orama — only loaded when backend='orama'
    // @ts-ignore — @orama/orama is an optional peer dep, not bundled
    const orama = await import('@orama/orama');
    const res = await fetch(oramaIndexUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const indexData = await res.json();
    const db = await orama.create({ schema: { __placeholder: 'string' as any } });
    await orama.load(db, indexData);
    const result = await orama.search(db, { term: query, limit });
    return (result.hits ?? []).map((hit: any) => ({
      slug: hit.document.url?.replace(/\/$/, '') || '',
      url: hit.document.url || '',
      title: hit.document.title || '',
      description: hit.document.desc || hit.document.description || '',
    }));
  } catch (err) {
    console.warn('[astro-webmcp] Orama search failed:', err);
    return [];
  }
}

/** Unified search dispatcher — picks backend based on config. */
async function searchContent(
  manifest: Manifest,
  query: string,
  collection?: string,
  limit = 5,
): Promise<ManifestEntry[]> {
  const backend = CONFIG.search?.backend ?? 'manifest';

  if (backend === 'pagefind') {
    const results = await searchPagefind(query, limit);
    if (results.length > 0) return results;
    // Fallback to manifest if pagefind returns nothing
  }

  if (backend === 'orama') {
    const results = await searchOrama(query, limit);
    if (results.length > 0) return results;
    // Fallback to manifest if orama returns nothing
  }

  return searchManifest(manifest, query, collection, limit);
}

// =============================================================================
// Declarative form scanning
// =============================================================================

/**
 * Scans the DOM for <form> elements annotated with `name` and `description`
 * attributes and registers them as WebMCP tools.
 *
 * This implements the spec's declarative API — the simplest path to WebMCP.
 * Forms with `name` and `description` become auto-discovered tools.
 */
function scanDeclarativeForms(mc: any, registerOptions: any): void {
  const forms = document.querySelectorAll<HTMLFormElement>('form[name][description]');
  for (const form of forms) {
    const name = form.getAttribute('name')!;
    const description = form.getAttribute('description')!;

    // Build input schema from form fields
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const inputs = form.querySelectorAll('input[name], select[name], textarea[name]');
    for (const input of inputs) {
      const fieldName = input.getAttribute('name')!;
      const type = input.getAttribute('type') || 'text';
      const fieldDesc = input.getAttribute('title') || input.getAttribute('aria-label') || fieldName;
      const isRequired = input.hasAttribute('required');

      let schemaType = 'string';
      if (type === 'number' || type === 'range') schemaType = 'number';
      if (type === 'checkbox') schemaType = 'boolean';

      properties[fieldName] = { type: schemaType, description: fieldDesc };
      if (isRequired) required.push(fieldName);
    }

    mc.registerTool(
      {
        name,
        description,
        annotations: { readOnlyHint: false }, // Forms mutate state
        inputSchema: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
        execute: async (params: Record<string, unknown>) => {
          // Fill form fields
          for (const [key, value] of Object.entries(params)) {
            const field = form.querySelector(`[name="${key}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
            if (field) {
              if (field instanceof HTMLInputElement && field.type === 'checkbox') {
                field.checked = Boolean(value);
              } else {
                field.value = String(value);
              }
            }
          }
          // Submit the form
          form.requestSubmit();
          return safeOutput({ submitted: true, form: name });
        },
      },
      registerOptions,
    );
  }
}

// =============================================================================
// Main initialization
// =============================================================================

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

  // Collect all tools for provideContext batch registration
  const tools: any[] = [];

  // Tool: search content
  tools.push({
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
      const results = await searchContent(manifest, args.query, args.collection, args.limit);
      return safeOutput(results);
    },
  });

  // Tool: list collections / sections
  tools.push({
    name: 'list_sections',
    description: 'List all content sections (collections) available on this site with item counts.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: { type: 'object', properties: {} },
    execute: async () => safeOutput(manifest.collections),
  });

  // Tool: navigate to content (state-mutating — uses requestUserInteraction)
  tools.push({
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
      if (!entry) {
        return 'Page not found. Use search_content to find available pages.';
      }
      // Request user consent before navigating (spec requirement for mutating tools)
      if (mc.requestUserInteraction) {
        const approved = await mc.requestUserInteraction({
          message: `Navigate to "${entry.title}" (${entry.url})?`,
        });
        if (!approved) return 'Navigation cancelled by user.';
      }
      window.location.href = entry.url;
      return null;
    },
  });

  // Tool: get current page info
  tools.push({
    name: 'get_page_info',
    description: 'Get metadata about the current page (title, description, headings, language, word count).',
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
      const lang = document.documentElement.lang || undefined;
      const canonical =
        document.querySelector('link[rel="canonical"]')?.getAttribute('href') || undefined;
      // Approximate word count from main content
      let wordCount: number | undefined;
      const main = document.querySelector('main');
      if (main) {
        const text = (main.textContent ?? '').replace(/\s+/g, ' ').trim();
        wordCount = text.split(/\s+/).length;
      }
      return safeOutput({
        title,
        description,
        headings,
        url: window.location.pathname,
        lang,
        canonical,
        wordCount,
      });
    },
  });

  // ---- Custom tools (user-defined via astro.config) ---------------------------
  if (CONFIG.customTools?.length) {
    for (const tool of CONFIG.customTools) {
      try {
        // eslint-disable-next-line no-new-func
        const executeFn = new Function('params', 'safeOutput', tool.executeBody) as (
          params: Record<string, unknown>,
          so: (data: unknown) => string,
        ) => unknown;
        tools.push({
          name: tool.name,
          description: tool.description,
          annotations: tool.annotations ?? { readOnlyHint: true },
          inputSchema: tool.inputSchema,
          execute: async (params: Record<string, unknown>) => {
            const result = executeFn(params, safeOutput);
            return result instanceof Promise ? await result : result;
          },
        });
      } catch (err) {
        console.warn(`[astro-webmcp] Failed to register custom tool "${tool.name}":`, err);
      }
    }
  }

  // Register all tools at once via provideContext (spec-preferred batch method)
  if (mc.provideContext) {
    mc.provideContext({ tools }, registerOptions);
  } else {
    // Fallback: register individually
    for (const tool of tools) {
      mc.registerTool(tool, registerOptions);
    }
  }

  // ---- Declarative form scanning (if enabled) --------------------------------
  if (CONFIG.formScanning) {
    scanDeclarativeForms(mc, registerOptions);
  }
})();
