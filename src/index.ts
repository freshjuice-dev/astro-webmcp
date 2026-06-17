import type { AstroIntegration } from 'astro';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CustomTool, SecurityOptions, WebMCPManifest, WebMCPOptions } from './types.js';

export type { WebMCPOptions, CustomTool, ManifestEntry, WebMCPManifest, SecurityOptions, ToolAnnotations } from './types.js';

/**
 * Astro integration that exposes site content via WebMCP for AI agents.
 *
 * Build time: generates /_webmcp/manifest.json with page metadata.
 * Browser: injects a script that registers tools via navigator.modelContext.
 *
 * Security applied per Chrome Agent Security Guidelines:
 * - Annotations (readOnlyHint, untrustedContentHint) on all tools
 * - Output character limit (prevents context overflow)
 * - Sanitization against indirect prompt injection
 * - Cross-origin control via exposedTo
 *
 * @see https://developer.chrome.com/docs/ai/webmcp/secure-tools
 * @see https://developer.chrome.com/docs/agents/security
 */
export default function astroWebMCP(options: WebMCPOptions = {}): AstroIntegration {
  let siteUrl: string | undefined;
  const security: Required<SecurityOptions> = {
    exposedTo: options.security?.exposedTo ?? [],
    maxOutputLength: options.security?.maxOutputLength ?? 1500,
    sanitizeOutputs: options.security?.sanitizeOutputs ?? true,
  };
  const customTools: CustomTool[] = options.customTools ?? [];

  const clientPath = join(dirname(fileURLToPath(import.meta.url)), 'client.js');

  return {
    name: '@freshjuice/astro-webmcp',

    hooks: {
      'astro:config:setup': ({ config, injectScript, logger }) => {
        siteUrl = config.site;

        const configScript =
          `globalThis.__WEBMCP_CONFIG__=${JSON.stringify({ ...security, customTools })};`;

        let clientCode: string;
        try {
          clientCode = readFileSync(clientPath, 'utf-8');
        } catch {
          clientCode = getInlineClient();
        }

        // head-inline bypasses Vite bundling — reliable on Astro v6.
        injectScript('head-inline', configScript + clientCode);
        logger.info('WebMCP tools registered with security annotations');
      },

      'astro:server:setup': ({ server, logger }) => {
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

        const collectionMap = new Map<string, number>();
        const entries: WebMCPManifest['entries'] = [];

        for (const page of pages) {
          const pathname = page.pathname;
          const segments = pathname.split('/').filter(Boolean);
          const collection = segments[0] || '_root';

          if (collectionsFilter && segments.length > 0 && !collectionsFilter.includes(collection)) {
            continue;
          }

          collectionMap.set(collection, (collectionMap.get(collection) ?? 0) + 1);

          const slug = pathname.replace(/\/$/, '') || '/';
          const url = '/' + pathname;
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

        const outPath = join(fileURLToPath(dir), '_webmcp', 'manifest.json');
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, JSON.stringify(manifest, null, 2));

        logger.info(`WebMCP manifest generated: ${entries.length} entries, ${manifest.collections.length} collections`);
      },
    },
  };
}

/** Extracts title and description from generated HTML. */
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

/** Minimal inline client fallback — with security applied. */
function getInlineClient(): string {
  return `(async()=>{const C=globalThis.__WEBMCP_CONFIG__||{maxOutputLength:1500,sanitizeOutputs:true};const mc=document.modelContext||navigator.modelContext;if(!mc?.registerTool)return;let m;try{const r=await fetch("/_webmcp/manifest.json");if(!r.ok)return;m=await r.json()}catch{return}function sn(t){if(!C.sanitizeOutputs)return t;return t.replace(/ignore\\s+(all\\s+)?(previous|above|prior)\\s+(instructions?|prompts?|rules?)/gi,"[filtered]").replace(/you\\s+are\\s+(now|a)\\s+/gi,"[filtered]").replace(/(system|assistant|user)\\s*:\\s*/gi,"[filtered]").replace(/<\\/?(?:system|instruction|prompt|command)[^>]*>/gi,"[filtered]")}function so(d){let s=JSON.stringify(d);s=sn(s);if(s.length>C.maxOutputLength)s=s.slice(0,C.maxOutputLength-13)+"...[truncated]";return s}const opts=C.exposedTo?.length?{exposedTo:C.exposedTo}:undefined;mc.registerTool({name:"search_content",description:"Search articles and pages on this site by keyword.",annotations:{readOnlyHint:true,untrustedContentHint:true},inputSchema:{type:"object",properties:{query:{type:"string",description:"Search term"},collection:{type:"string",description:"Filter by collection (optional)"},limit:{type:"number",description:"Max results (default: 5)"}},required:["query"]},execute:async({query:q,collection:c,limit:l=5})=>{const t=q.toLowerCase();let r=m.entries.filter(e=>e.title.toLowerCase().includes(t)||(e.description||"").toLowerCase().includes(t));if(c)r=r.filter(e=>e.collection===c);return so(r.slice(0,Math.min(l,20)))}},opts);mc.registerTool({name:"list_sections",description:"List content sections available on this site.",annotations:{readOnlyHint:true},inputSchema:{type:"object",properties:{}},execute:async()=>so(m.collections)},opts);mc.registerTool({name:"go_to",description:"Navigate to a page by slug.",annotations:{readOnlyHint:false},inputSchema:{type:"object",properties:{slug:{type:"string",description:"Page slug or path"}},required:["slug"]},execute:async({slug:s})=>{const e=m.entries.find(x=>x.slug===s||x.url===s||x.url==="/"+s+"/");if(e){window.location.href=e.url;return null}return"Page not found. Use search_content to find available pages."}},opts);mc.registerTool({name:"get_page_info",description:"Get metadata about the current page (title, description, headings).",annotations:{readOnlyHint:true,untrustedContentHint:true},inputSchema:{type:"object",properties:{}},execute:async()=>{const t=document.title;const d=document.querySelector('meta[name="description"]')?.getAttribute("content")??"";const h=Array.from(document.querySelectorAll("h1, h2, h3")).map(e=>({level:parseInt(e.tagName[1]),text:e.textContent?.trim()??""}));return so({title:t,description:d,headings:h,url:window.location.pathname})}},opts);if(C.customTools?.length)for(const ct of C.customTools)try{const ef=new Function("params","safeOutput",ct.executeBody);mc.registerTool({name:ct.name,description:ct.description,annotations:ct.annotations??{readOnlyHint:true},inputSchema:ct.inputSchema,execute:async(p)=>{const r=ef(p,so);return r instanceof Promise?await r:r}},opts)}catch(e){console.warn('[astro-webmcp] Failed to register custom tool "'+ct.name+'":',e)}})()`;
}
