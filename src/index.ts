import type { AstroIntegration } from 'astro';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebMCPManifest, WebMCPOptions } from './types.js';

export type { WebMCPOptions, CustomTool, ManifestEntry, WebMCPManifest } from './types.js';

/**
 * Astro integration que expõe conteúdo do site via WebMCP.
 *
 * No build: gera /_webmcp/manifest.json com metadados das páginas.
 * No browser: injeta script que registra tools via document.modelContext.
 */
export default function astroWebMCP(options: WebMCPOptions = {}): AstroIntegration {
  let siteUrl: string | undefined;

  // Lê o script client como string para injetar
  const clientPath = join(dirname(fileURLToPath(import.meta.url)), 'client.js');

  return {
    name: 'astro-webmcp',

    hooks: {
      'astro:config:setup': ({ config, injectScript, logger }) => {
        siteUrl = config.site;

        // Lê o script client compilado e injeta em toda página
        let clientCode: string;
        try {
          clientCode = readFileSync(clientPath, 'utf-8');
        } catch {
          // Fallback: inline mínimo que carrega manifest e registra tools
          clientCode = getInlineClient();
        }

        injectScript('page', clientCode);
        logger.info('WebMCP tools will be registered on all pages');
      },

      'astro:server:setup': ({ server, logger }) => {
        // Serve um manifesto dinâmico no dev (lista páginas conhecidas)
        server.middlewares.use('/_webmcp/manifest.json', (_req, res) => {
          const manifest: WebMCPManifest = {
            generatedAt: new Date().toISOString(),
            site: siteUrl,
            collections: [],
            entries: [
              { slug: '/', url: '/', title: 'Home', description: 'Homepage' },
            ],
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(manifest));
        });
        logger.info('WebMCP dev manifest available at /_webmcp/manifest.json');
      },

      'astro:build:done': async ({ dir, pages, logger }) => {
        const collectionsFilter = options.collections;

        // Extrai collections das paths das páginas
        const collectionMap = new Map<string, number>();
        const entries: WebMCPManifest['entries'] = [];

        for (const page of pages) {
          const pathname = page.pathname;
          const segments = pathname.split('/').filter(Boolean);
          const collection = segments[0] || '_root';

          // Filtrar collections se especificado
          if (collectionsFilter && segments.length > 0 && !collectionsFilter.includes(collection)) {
            continue;
          }

          collectionMap.set(collection, (collectionMap.get(collection) ?? 0) + 1);

          const slug = pathname.replace(/\/$/, '') || '/';
          const url = '/' + pathname;

          // Tenta extrair título do HTML gerado
          const { title, description } = extractMeta(dir, pathname);

          entries.push({
            slug,
            url,
            title,
            description,
            collection: segments.length > 0 ? collection : undefined,
          });
        }

        const manifest: WebMCPManifest = {
          generatedAt: new Date().toISOString(),
          site: siteUrl,
          collections: Array.from(collectionMap.entries())
            .filter(([name]) => name !== '_root')
            .map(([name, count]) => ({ name, count })),
          entries,
        };

        // Escreve o manifesto no output
        const outPath = join(fileURLToPath(dir), '_webmcp', 'manifest.json');
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, JSON.stringify(manifest, null, 2));

        logger.info(`WebMCP manifest generated: ${entries.length} entries, ${manifest.collections.length} collections`);
      },
    },
  };
}

/** Extrai title e description do HTML gerado */
function extractMeta(dir: URL, pathname: string): { title: string; description: string } {
  try {
    const htmlPath = join(fileURLToPath(dir), pathname, 'index.html');
    const html = readFileSync(htmlPath, 'utf-8');

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);

    return {
      title: titleMatch?.[1]?.trim() ?? pathname.split('/').filter(Boolean).pop() ?? 'Home',
      description: descMatch?.[1]?.trim() ?? '',
    };
  } catch {
    return {
      title: pathname.split('/').filter(Boolean).pop() ?? 'Home',
      description: '',
    };
  }
}

/** Client inline mínimo como fallback */
function getInlineClient(): string {
  return `(async()=>{const mc=document.modelContext||navigator.modelContext;if(!mc?.registerTool)return;let m;try{const r=await fetch("/_webmcp/manifest.json");if(!r.ok)return;m=await r.json()}catch{return}mc.registerTool({name:"search_content",description:"Search articles and pages on this site by keyword.",inputSchema:{type:"object",properties:{query:{type:"string",description:"Search term"},limit:{type:"number",description:"Max results (default: 5)"}},required:["query"]},execute:async({query:q,limit:l=5})=>{const t=q.toLowerCase();return JSON.stringify(m.entries.filter(e=>e.title.toLowerCase().includes(t)||(e.description||"").toLowerCase().includes(t)).slice(0,l))}});mc.registerTool({name:"list_sections",description:"List content sections available on this site.",inputSchema:{type:"object",properties:{}},execute:async()=>JSON.stringify(m.collections)});mc.registerTool({name:"go_to",description:"Navigate to a page by slug.",inputSchema:{type:"object",properties:{slug:{type:"string"}},required:["slug"]},execute:async({slug:s})=>{const e=m.entries.find(x=>x.slug===s||x.url===s||x.url==="/"+s+"/");if(e){window.location.href=e.url;return null}return"Not found"}});mc.registerTool({name:"get_page_info",description:"Get current page metadata.",inputSchema:{type:"object",properties:{}},execute:async()=>JSON.stringify({title:document.title,description:document.querySelector('meta[name="description"]')?.getAttribute("content")||"",url:location.pathname})})})();`;
}
