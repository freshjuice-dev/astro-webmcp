/**
 * Client-side script injected into every page.
 * Loads the manifest and registers WebMCP tools via document.modelContext.
 *
 * Conforms to the WebMCP spec (webmachinelearning/webmcp) as of 2026-07:
 * - document.modelContext as primary API surface
 * - provideContext() batch registration with registerTool() fallback
 * - AbortController / signal for tool lifecycle management
 * - requestUserInteraction() for state-mutating tools
 * - Structured content response format
 *
 * Security applied per Chrome Agent Security Guidelines:
 * - readOnlyHint on all non-mutating tools
 * - untrustedContentHint on tools returning page content
 * - Output character limit (prevents context overflow)
 * - Sanitization against indirect prompt injection
 * - exposedTo for cross-origin control
 * - requestUserInteraction() for state-mutating tools (go_to)
 *
 * @see https://webmachinelearning.github.io/webmcp/
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
  headings?: Array<{ id: string; text: string; level: number }>;
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

interface CustomToolConfig {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  executeBody: string;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}

interface WebMCPClientConfig {
  exposedTo?: string[];
  maxOutputLength: number;
  sanitizeOutputs: boolean;
  customTools?: CustomToolConfig[];
  formScanning?: boolean;
  search?: SearchConfig;
  debug?: boolean;
}

const CONFIG: WebMCPClientConfig = (globalThis as any).__WEBMCP_CONFIG__ ?? {
  maxOutputLength: 1500,
  sanitizeOutputs: true,
  debug: false,
};

const log = {
  debug: (...args: unknown[]) => { if (CONFIG.debug) console.debug('[astro-webmcp]', ...args); },
  info: (...args: unknown[]) => { if (CONFIG.debug) console.info('[astro-webmcp]', ...args); },
  warn: (...args: unknown[]) => console.warn('[astro-webmcp]', ...args),
};

function truncateOutput(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 13) + '...[truncated]';
}

function sanitize(text: string): string {
  if (!CONFIG.sanitizeOutputs) return text;
  return text
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, '[filtered]')
    .replace(/you\s+are\s+(now|a)\s+/gi, '[filtered]')
    .replace(/(system|assistant|user)\s*:\s*/gi, '[filtered]')
    .replace(/<\/?(?:system|instruction|prompt|command)[^>]*>/gi, '[filtered]');
}

function safeOutput(data: unknown): { content: Array<{ type: string; text: string }> } {
  let str = JSON.stringify(data);
  str = sanitize(str);
  str = truncateOutput(str, CONFIG.maxOutputLength);
  return { content: [{ type: 'text', text: str }] };
}

// =============================================================================
// Search backends
// =============================================================================

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

async function searchPagefind(
  query: string,
  limit = 5,
): Promise<ManifestEntry[]> {
  const pf = (window as any).pagefind;
  if (!pf) {
    log.warn('pagefind not found on window — falling back to manifest search');
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
    log.warn('Pagefind search failed:', err);
    return [];
  }
}

async function searchOrama(
  query: string,
  limit = 5,
): Promise<ManifestEntry[]> {
  const oramaIndexUrl = CONFIG.search?.oramaIndexUrl;
  if (!oramaIndexUrl) {
    log.warn('oramaIndexUrl not configured — falling back to manifest search');
    return [];
  }
  try {
    // @ts-ignore — @orama/orama is an optional peer dep, not bundled
    const orama = await import(/* @vite-ignore */ '@orama/orama');
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
    log.warn('Orama search failed:', err);
    return [];
  }
}

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
  }

  if (backend === 'orama') {
    const results = await searchOrama(query, limit);
    if (results.length > 0) return results;
  }

  return searchManifest(manifest, query, collection, limit);
}

// =============================================================================
// Declarative form scanning
// =============================================================================

function scanDeclarativeForms(mc: any, registerOptions: any): number {
  const forms = document.querySelectorAll<HTMLFormElement>('form[name][description]');
  let count = 0;
  for (const form of forms) {
    const name = form.getAttribute('name')!;
    const description = form.getAttribute('description')!;

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
        annotations: { readOnlyHint: false },
        inputSchema: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
        execute: async (params: Record<string, unknown>) => {
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
          form.requestSubmit();
          return safeOutput({ submitted: true, form: name });
        },
      },
      registerOptions,
    );
    count++;
  }
  return count;
}

// =============================================================================
// Main initialization
// =============================================================================

(async () => {
  const mc = (document as any).modelContext ?? (navigator as any).modelContext;
  if (!mc?.registerTool) {
    log.debug('modelContext not available — WebMCP not supported in this browser');
    return;
  }

  let manifest: Manifest;
  try {
    const res = await fetch('/_webmcp/manifest.json');
    if (!res.ok) {
      log.warn(`manifest fetch failed: HTTP ${res.status}`);
      return;
    }
    manifest = await res.json();
  } catch (err) {
    log.warn('manifest fetch error:', err);
    return;
  }

  log.debug(`manifest loaded: ${manifest.entries.length} entries, ${manifest.collections.length} collections`);

  const controller = new AbortController();
  const { signal } = controller;

  const registerOptions: Record<string, unknown> = { signal };
  if (CONFIG.exposedTo?.length) {
    registerOptions.exposedTo = CONFIG.exposedTo;
  }

  const tools: any[] = [];

  tools.push({
    name: 'search_content',
    description: 'Search articles and pages on this site by keyword. Returns title, URL, and description of matching results.',
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
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

  tools.push({
    name: 'list_sections',
    description: 'List all content sections (collections) available on this site with item counts.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: { type: 'object', properties: {} },
    execute: async () => safeOutput(manifest.collections),
  });

  tools.push({
    name: 'go_to',
    description: 'Navigate to a specific page on this site by its slug.',
    annotations: {
      readOnlyHint: false,
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
        return safeOutput({ error: 'Page not found. Use search_content to find available pages.' });
      }
      if (mc.requestUserInteraction) {
        const approved = await mc.requestUserInteraction({
          message: `Navigate to "${entry.title}" (${entry.url})?`,
        });
        if (!approved) {
          return safeOutput({ cancelled: true, message: 'Navigation cancelled by user.' });
        }
      }
      window.location.href = entry.url;
      return null;
    },
  });

  tools.push({
    name: 'get_page_info',
    description: 'Get metadata about the current page (title, description, headings, language, word count, canonical URL).',
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const title = document.title;
      const description =
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map((h) => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim() ?? '',
        ...(h.id ? { id: h.id } : {}),
      }));
      const lang = document.documentElement.lang || undefined;
      const canonical =
        document.querySelector('link[rel="canonical"]')?.getAttribute('href') || undefined;
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

  if (CONFIG.customTools?.length) {
    for (const tool of CONFIG.customTools) {
      try {
        // eslint-disable-next-line no-new-func
        const executeFn = new Function('params', 'safeOutput', tool.executeBody) as (
          params: Record<string, unknown>,
          so: typeof safeOutput,
        ) => unknown;
        tools.push({
          name: tool.name,
          description: tool.description,
          annotations: tool.annotations ?? { readOnlyHint: true },
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          execute: async (params: Record<string, unknown>) => {
            const result = executeFn(params, safeOutput);
            return result instanceof Promise ? await result : result;
          },
        });
      } catch (err) {
        log.warn(`Failed to register custom tool "${tool.name}":`, err);
      }
    }
  }

  if (mc.provideContext) {
    mc.provideContext({ tools }, registerOptions);
  } else {
    for (const tool of tools) {
      mc.registerTool(tool, registerOptions);
    }
  }
  log.info(`${tools.length} tool${tools.length === 1 ? '' : 's'} registered via ${mc.provideContext ? 'provideContext()' : 'registerTool()'}`);

  (globalThis as any).__WEBMCP_ABORT__ = () => controller.abort();

  if (CONFIG.formScanning) {
    const formCount = scanDeclarativeForms(mc, registerOptions);
    if (formCount > 0) {
      log.info(`${formCount} declarative form${formCount === 1 ? '' : 's'} registered as tools`);
    }
  }
})();