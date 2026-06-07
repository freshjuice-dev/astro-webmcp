/**
 * Script client-side injetado em toda página.
 * Carrega o manifesto e registra tools WebMCP via document.modelContext.
 *
 * Este arquivo é lido como string pelo integration e injetado via injectScript.
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

  // Tool: buscar conteúdo
  mc.registerTool({
    name: 'search_content',
    description: 'Search articles and pages on this site by keyword. Returns title, URL, and description of matching results.',
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
      const limit = args.limit ?? 5;
      let results = manifest.entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q) ||
          (e.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
      if (args.collection) {
        results = results.filter((e) => e.collection === args.collection);
      }
      return JSON.stringify(results.slice(0, limit));
    },
  });

  // Tool: listar collections/seções
  mc.registerTool({
    name: 'list_sections',
    description: 'List all content sections (collections) available on this site with item counts.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => JSON.stringify(manifest.collections),
  });

  // Tool: navegar para conteúdo
  mc.registerTool({
    name: 'go_to',
    description: 'Navigate to a specific page on this site by its slug.',
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
  });

  // Tool: obter conteúdo da página atual
  mc.registerTool({
    name: 'get_page_info',
    description: 'Get metadata about the current page (title, description, headings).',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const title = document.title;
      const description =
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map((h) => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim() ?? '',
      }));
      return JSON.stringify({ title, description, headings, url: window.location.pathname });
    },
  });
})();
