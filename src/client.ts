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
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  executeBody: string;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean; debugging?: boolean };
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
  const suffix = '...[truncated]';
  return str.slice(0, Math.max(0, max - suffix.length)) + suffix.slice(0, max);
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
  let str = JSON.stringify(data) ?? 'null';
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

function getLabelDesc(el: HTMLElement): string {
  // Chrome: toolparamdescription → <label> content → aria-description
  const explicit = el.getAttribute('toolparamdescription');
  if (explicit) return explicit;
  // Associated <label for="id">
  if (el.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  // Wrapping <label>
  const parent = el.closest('label');
  if (parent?.textContent?.trim()) return parent.textContent.trim();
  // aria-description (Chrome's third fallback)
  if (el.getAttribute('aria-description')) return el.getAttribute('aria-description')!;
  // Extra fallbacks beyond Chrome's chain
  if (el.getAttribute('title')) return el.getAttribute('title')!;
  return el.getAttribute('name') || '';
}

function selectToSchema(sel: HTMLSelectElement, desc: string): Record<string, unknown> {
  // Chrome: anyOf with const+title per <option>, plus enum array
  const options = Array.from(sel.querySelectorAll('option'));
  const enumValues = options.map(o => o.value || o.textContent?.trim() || '');
  const anyOf = options.map(o => ({
    type: 'string',
    const: o.value || o.textContent?.trim() || '',
    title: o.textContent?.trim() || undefined,
  }));
  return {
    type: 'string',
    anyOf: anyOf.filter(o => o.const),
    enum: enumValues.filter(Boolean),
    description: desc,
  };
}

async function scanDeclarativeForms(mc: any): Promise<any[]> {
  const forms = document.querySelectorAll<HTMLFormElement>(
    'form[toolname][tooldescription], form[name][description]',
  );
  const existing = typeof mc.getTools === 'function' ? await mc.getTools() : [];
  const nativeNames = new Set(existing.filter((tool: any) => tool.window === window).map((tool: any) => tool.name));
  const seen = new Set<string>();
  const tools: any[] = [];
  for (const form of forms) {
    const name = (form.getAttribute('toolname') ?? form.getAttribute('name'))!;
    if (form.hasAttribute('toolname') && nativeNames.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const description = (form.getAttribute('tooldescription') ?? form.getAttribute('description'))!;
    const autoSubmit = form.hasAttribute('toolautosubmit');

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]');
    for (const field of fields) {
      const fieldName = field.getAttribute('name')!;
      const desc = getLabelDesc(field);
      const isRequired = field.hasAttribute('required');

      if (field instanceof HTMLSelectElement) {
        properties[fieldName] = selectToSchema(field, desc);
      } else {
        let schemaType = 'string';
        const type = field.getAttribute('type') || 'text';
        if (type === 'number' || type === 'range') schemaType = 'number';
        if (type === 'checkbox') schemaType = 'boolean';
        properties[fieldName] = { type: schemaType, description: desc };
      }
      if (isRequired) required.push(fieldName);
    }

    tools.push(
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
          if (autoSubmit) form.requestSubmit();
          return safeOutput({ submitted: autoSubmit, form: name });
        },
      },
    );
  }
  return tools;
}

// =============================================================================
// Main initialization
// =============================================================================

async function initWebMCP(): Promise<void> {
  (globalThis as any).__WEBMCP_ABORT__?.();
  const mc = (document as any).modelContext ?? (navigator as any).modelContext;
  if (!mc?.registerTool) {
    log.debug('modelContext not available — WebMCP not supported in this browser');
    return;
  }

  const controller = new AbortController();
  const { signal } = controller;
  (globalThis as any).__WEBMCP_ABORT__ = () => controller.abort();

  let manifest: Manifest;
  try {
    const res = await fetch('/_webmcp/manifest.json', { signal });
    if (!res.ok) {
      log.warn(`manifest fetch failed: HTTP ${res.status}`);
      return;
    }
    manifest = await res.json();
    if (signal.aborted) return;
    if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.collections)) {
      throw new Error('Invalid WebMCP manifest: expected entries and collections arrays');
    }
  } catch (err) {
    if (!signal.aborted) log.warn('manifest fetch error:', err);
    return;
  }

  log.debug(`manifest loaded: ${manifest.entries.length} entries, ${manifest.collections.length} collections`);

  const registerOptions: Record<string, unknown> = { signal };
  if (CONFIG.exposedTo?.length) {
    registerOptions.exposedTo = CONFIG.exposedTo;
  }

  const tools: any[] = [];

  tools.push({
    name: 'search_content',
    title: 'Search Content',
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
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Max results to return (default: 5)' },
      },
      required: ['query'],
    },
    execute: async (args: { query: string; collection?: string; limit?: number }) => {
      if (typeof args?.query !== 'string' || !args.query.trim()) {
        return safeOutput({ error: 'query must be a non-empty string.' });
      }
      if (args.collection !== undefined && typeof args.collection !== 'string') {
        return safeOutput({ error: 'collection must be a string.' });
      }
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1)) {
        return safeOutput({ error: 'limit must be a positive integer (maximum 20).' });
      }
      const results = await searchContent(manifest, args.query, args.collection, Math.min(args.limit ?? 5, 20));
      return safeOutput(results);
    },
  });

  tools.push({
    name: 'list_sections',
    title: 'List Sections',
    description: 'List all content sections (collections) available on this site with item counts.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: { type: 'object', properties: {} },
    execute: async () => safeOutput(manifest.collections),
  });

  tools.push({
    name: 'go_to',
    title: 'Go To Page',
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
    execute: async (args: { slug: string }, context?: { signal: AbortSignal }) => {
      if (typeof args?.slug !== 'string' || !args.slug.trim()) {
        return safeOutput({ error: 'slug must be a non-empty string.' });
      }
      const entry = manifest.entries.find(
        (e) => e.slug === args.slug || e.url === args.slug || e.url === `/${args.slug}/`,
      );
      if (!entry) {
        return safeOutput({ error: 'Page not found. Use search_content to find available pages.' });
      }
      const target = new URL(entry.url, window.location.href);
      if (target.origin !== window.location.origin || !['https:', 'http:'].includes(target.protocol)) {
        return safeOutput({ error: 'Navigation is restricted to pages on this site.' });
      }
      if (mc.requestUserInteraction) {
        const approved = await mc.requestUserInteraction({
          message: `Navigate to "${entry.title}" (${entry.url})?`,
        });
        if (!approved) {
          return safeOutput({ cancelled: true, message: 'Navigation cancelled by user.' });
        }
      }
      context?.signal?.throwIfAborted();
      window.location.href = target.href;
      return null;
    },
  });

  tools.push({
    name: 'get_page_info',
    title: 'Get Page Info',
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
      if (CONFIG.debug) {
        if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name)) log.warn(`tool "${tool.name}": name must match [a-zA-Z0-9_.-] and be 1–128 chars (spec §3)`);
        if (tool.name.length > 30) log.warn(`tool "${tool.name}": name ${tool.name.length} chars (recommended ≤30)`);
        if (tool.description.length > 500) log.warn(`tool "${tool.name}": description ${tool.description.length} chars (recommended ≤500)`);
        const props = (tool.inputSchema as any)?.properties ?? {};
        for (const [pName, p] of Object.entries(props)) {
          if (pName.length > 30) log.warn(`tool "${tool.name}" param "${pName}": name ${pName.length} chars (recommended ≤30)`);
          const d = (p as any)?.description;
          if (typeof d === 'string' && d.length > 150) log.warn(`tool "${tool.name}" param "${pName}": description ${d.length} chars (recommended ≤150)`);
        }
      }
      try {
        const executeFn = new Function('params', 'safeOutput', 'signal', `return (async () => {${tool.executeBody}\n})();`) as (
          params: Record<string, unknown>,
          so: typeof safeOutput,
          signal?: AbortSignal,
        ) => unknown;
        tools.push({
          name: tool.name,
          title: tool.title ?? tool.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          description: tool.description,
          annotations: { readOnlyHint: false, ...tool.annotations },
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          execute: async (params: Record<string, unknown>, context?: { signal: AbortSignal }) => {
            return executeFn(params, safeOutput, context?.signal);
          },
        });
      } catch (err) {
        controller.abort();
        log.warn(`Failed to compile custom tool "${tool.name}":`, err);
        return;
      }
    }
  }

  try {
    if (CONFIG.formScanning) tools.push(...await scanDeclarativeForms(mc));
    for (const tool of tools) {
      if (signal.aborted) return;
      const execute = tool.execute;
      tool.execute = async (params: Record<string, unknown>, context?: { signal: AbortSignal }) => {
        context?.signal?.throwIfAborted();
        return execute(params, context);
      };
      await mc.registerTool(tool, registerOptions);
    }
    if (signal.aborted) return;
    log.info(`${tools.length} tools registered`);
  } catch (err) {
    if (signal.aborted) return;
    controller.abort();
    log.warn('Tool registration failed; rolled back this batch:', err);
  }
}

initWebMCP();

document.addEventListener('astro:before-swap', () => {
  (globalThis as any).__WEBMCP_ABORT__?.();
});
document.addEventListener('astro:after-swap', initWebMCP);