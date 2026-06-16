/**
 * Script client-side injetado em toda página.
 * Carrega o manifesto e registra tools WebMCP via document.modelContext.
 *
 * Segurança aplicada conforme Chrome Agent Security Guidelines:
 * - readOnlyHint em todas as tools que não mutam estado
 * - untrustedContentHint em tools que retornam conteúdo de páginas
 * - Limite de caracteres nos outputs (previne context overflow)
 * - Sanitização contra indirect prompt injection
 * - exposedTo para controle cross-origin
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

/** Config injetada pelo integration via __WEBMCP_CONFIG__ */
interface WebMCPClientConfig {
  exposedTo?: string[];
  maxOutputLength: number;
  sanitizeOutputs: boolean;
}

// Config é substituída no build pelo integration
const CONFIG: WebMCPClientConfig = (globalThis as any).__WEBMCP_CONFIG__ ?? {
  maxOutputLength: 1500,
  sanitizeOutputs: true,
};

/**
 * Trunca output respeitando o limite de caracteres.
 * Previne context window overflow no agent (guardrail determinístico).
 */
function truncateOutput(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 13) + '...[truncated]';
}

/**
 * Sanitiza conteúdo para mitigar indirect prompt injection.
 * Remove padrões comuns de instruções embutidas em conteúdo.
 */
function sanitize(text: string): string {
  if (!CONFIG.sanitizeOutputs) return text;
  return text
    // Remove padrões de "ignore previous instructions"
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, '[filtered]')
    // Remove tentativas de role-play/system prompt injection
    .replace(/you\s+are\s+(now|a)\s+/gi, '[filtered]')
    .replace(/(system|assistant|user)\s*:\s*/gi, '[filtered]')
    // Remove marcadores de instruções
    .replace(/<\/?(?:system|instruction|prompt|command)[^>]*>/gi, '[filtered]');
}

/**
 * Envelopa output com sanitização e truncamento.
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

  // Opções de registro compartilhadas (exposedTo para cross-origin control)
  const registerOptions = CONFIG.exposedTo?.length
    ? { exposedTo: CONFIG.exposedTo }
    : undefined;

  // Tool: buscar conteúdo
  mc.registerTool({
    name: 'search_content',
    description: 'Search articles and pages on this site by keyword. Returns title, URL, and description of matching results.',
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true, // Conteúdo vem de páginas que podem ter UGC
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
      const limit = Math.min(args.limit ?? 5, 20); // Cap máximo de resultados
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

  // Tool: listar collections/seções
  mc.registerTool({
    name: 'list_sections',
    description: 'List all content sections (collections) available on this site with item counts.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: { type: 'object', properties: {} },
    execute: async () => safeOutput(manifest.collections),
  }, registerOptions);

  // Tool: navegar para conteúdo
  mc.registerTool({
    name: 'go_to',
    description: 'Navigate to a specific page on this site by its slug.',
    annotations: {
      readOnlyHint: false, // Altera estado (navegação)
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

  // Tool: obter conteúdo da página atual
  mc.registerTool({
    name: 'get_page_info',
    description: 'Get metadata about the current page (title, description, headings).',
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true, // DOM pode conter UGC (comentários, etc)
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
})();
