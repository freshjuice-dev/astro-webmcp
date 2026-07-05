/**
 * WebMCP SSR middleware — serves dynamic manifest with route caching (v7).
 * This file is processed by Astro's Vite pipeline at runtime.
 */
export const onRequest = async (context, next) => {
  const linkHeader = [
    '</_webmcp/manifest.json>; rel="webmcp"',
    '</.well-known/skills/index.json>; rel="skills"',
    '</.well-known/mcp/server-card.json>; rel="mcp-server-card"',
  ].join(', ');

  if (context.url.pathname !== '/_webmcp/manifest.json') {
    const response = await next();
    if (response && response.headers) {
      response.headers.set('Link', linkHeader);
    }
    return response;
  }

  // v7 route caching (feature detection — noop on v6)
  if (context.cache && typeof context.cache.set === 'function') {
    context.cache.set({
      maxAge: 60,
      swr: 30,
      tags: ['webmcp-manifest'],
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    site: context.site?.toString(),
    dynamic: true,
    url: context.url.pathname,
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=30',
      'Link': linkHeader,
    },
  });
};