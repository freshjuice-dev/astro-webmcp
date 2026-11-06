import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'astro';
import webmcp from '../dist/index.js';
import { onRequest } from '../dist/middleware.mjs';

function injectedScript(options = {}) {
  let script;
  webmcp(options).hooks['astro:config:setup']({
    config: { site: 'https://example.com', output: 'static' },
    command: 'build',
    injectScript(stage, code) {
      assert.equal(stage, 'head-inline');
      script = code;
    },
    logger: { info() {} },
  });
  return script;
}

test('injected configuration cannot terminate the script element', () => {
  const source = injectedScript({ customTools: [{
    name: 'example',
    description: '</script><script>alert(1)</script>',
    inputSchema: { type: 'object' },
    executeBody: 'return "</script>";',
  }] });
  assert.doesNotMatch(source, /<\/script/i);
});

test('the inline client can run again without redeclaring global bindings', () => {
  const source = injectedScript();
  const context = { document: { addEventListener() {} }, navigator: {}, console };
  runInNewContext(source, context);
  runInNewContext(source, context);
});

test('an Astro site builds with an executable client and generated discovery files', async () => {
  const root = new URL('../_temp/astro-smoke/', import.meta.url);
  await mkdir(new URL('src/pages/', root), { recursive: true });
  await writeFile(new URL('src/pages/index.astro', root), '<html lang="en"><head><title>WebMCP smoke test</title><meta name="description" content="A real Astro build"></head><body><main><h1 id="test">WebMCP smoke test</h1></main></body></html>');
  await build({ root, configFile: false, site: 'https://example.com', integrations: [webmcp()], logLevel: 'error' });
  const html = await readFile(new URL('dist/index.html', root), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.some(([, code]) => code.includes('__WEBMCP_CONFIG__')));
  for (const [, code] of scripts) new Function(code);
  const manifest = JSON.parse(await readFile(new URL('dist/_webmcp/manifest.json', root), 'utf8'));
  assert.equal(manifest.entries[0].title, 'WebMCP smoke test');
  assert.equal(manifest.entries[0].url, '/');
  for (const path of ['.well-known/skills/index.json', '.well-known/mcp/server-card.json']) {
    assert.ok(JSON.parse(await readFile(new URL(`dist/${path}`, root), 'utf8')));
  }
  const card = JSON.parse(await readFile(new URL('dist/.well-known/mcp/server-card.json', root), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(card.serverInfo.version, pkg.version);
  const ssrRes = await onRequest({ url: new URL('https://example.com/_webmcp/manifest.json'), site: new URL('https://example.com') }, async () => new Response());
  const ssrManifest = await ssrRes.json();
  assert.ok(Array.isArray(ssrManifest.entries) && Array.isArray(ssrManifest.collections));
});
