import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8');

async function loadClient(config = {}, overrides = {}) {
  const tools = new Map();
  const warnings = [];
  const document = new EventTarget();
  document.modelContext = {
    async registerTool(tool, { signal }) {
      if (tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
      if (signal.aborted) return;
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
    },
  };
  document.querySelectorAll = () => [];
  const context = {
    __WEBMCP_CONFIG__: { maxOutputLength: 1500, sanitizeOutputs: true, ...config },
    document,
    navigator: {},
    window: { location: { href: 'https://example.com/', pathname: '/', origin: 'https://example.com' } },
    console: { debug() {}, info() {}, warn: (...args) => warnings.push(args) },
    AbortController,
    URL,
    fetch: async () => ({ ok: true, json: async () => ({ entries: [], collections: [] }) }),
    ...overrides,
  };
  overrides.prepare?.(context, tools);
  runInNewContext(source, context);
  await setImmediate();
  return { tools, warnings, context, document };
}

const customTool = {
  name: 'check_signal',
  description: 'Check execution cancellation',
  inputSchema: { type: 'object', properties: {} },
  executeBody: 'return signal;',
};

test('custom tools receive the per-execution signal rather than the registration signal', async () => {
  const { tools, context } = await loadClient({ customTools: [customTool] });
  const execution = new AbortController();
  const received = await tools.get(customTool.name).execute({}, { signal: execution.signal });
  assert.equal(received, execution.signal);
  execution.abort();
  assert.equal(received.aborted, true);
  assert.equal(tools.size, 5);
  context.__WEBMCP_ABORT__();
  assert.equal(tools.size, 0);
});

test('a failed registration rolls back the complete tool batch', async () => {
  const { tools, warnings } = await loadClient({ customTools: [{ ...customTool, name: 'search_content' }] });
  assert.equal(tools.size, 0);
  assert.equal(warnings.length, 1);
});

test('custom bodies support await while preserving params and safeOutput', async () => {
  const { tools } = await loadClient({ customTools: [{ ...customTool, executeBody: 'return safeOutput(await Promise.resolve(params));' }] });
  const output = await tools.get(customTool.name).execute({ value: 42 });
  assert.equal(output.content[0].text, '{"value":42}');
});

test('navigation cancels pending initialization and ignores stale manifest responses', async () => {
  let resolveFirst;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const signals = [];
  const { tools, document } = await loadClient({}, {
    fetch: async (_url, options) => {
      signals.push(options?.signal);
      if (signals.length === 1) await first;
      return { ok: true, json: async () => ({ entries: [], collections: [] }) };
    },
  });
  document.dispatchEvent(new Event('astro:before-swap'));
  assert.equal(signals[0]?.aborted, true);
  document.dispatchEvent(new Event('astro:after-swap'));
  await setImmediate();
  assert.equal(tools.size, 4);
  resolveFirst();
  await setImmediate();
  assert.equal(tools.size, 4);
  document.dispatchEvent(new Event('astro:before-swap'));
  assert.equal(tools.size, 0);
});

test('custom tools default to mutating and preserve explicit titles and current annotations', async () => {
  const { tools } = await loadClient({ customTools: [
    customTool,
    { ...customTool, name: 'debug_tool', title: 'Inspect state', annotations: { readOnlyHint: true, consequentialHint: true, debugging: true } },
  ] });
  assert.equal(tools.get(customTool.name).annotations.readOnlyHint, false);
  const debug = tools.get('debug_tool');
  assert.equal(debug.title, 'Inspect state');
  assert.equal(debug.annotations.consequentialHint, true);
  assert.equal(debug.annotations.debugging, true);
  assert.equal(debug.annotations.readOnlyHint, true);
});

test('already-cancelled executions never enter custom tool bodies', async () => {
  const { tools, context } = await loadClient({ customTools: [{ ...customTool, executeBody: 'globalThis.executed = true;' }] });
  const execution = new AbortController();
  execution.abort();
  await assert.rejects(tools.get(customTool.name).execute({}, { signal: execution.signal }), { name: 'AbortError' });
  assert.equal(context.executed, undefined);
});

test('search validates arguments in code instead of trusting its schema', async () => {
  const { tools } = await loadClient();
  const search = tools.get('search_content');
  for (const args of [{}, { query: 1 }, { query: 'x', limit: -1 }, { query: 'x', limit: 1.5 }, { query: 'x', collection: 1 }]) {
    const output = await search.execute(args);
    assert.equal(typeof JSON.parse(output.content[0].text).error, 'string');
  }
});

test('native form tools in this window are preserved rather than registered twice', async () => {
  const native = { name: 'native_form' };
  const { tools, warnings } = await loadClient({ formScanning: true }, {
    prepare(context, tools) {
      tools.set(native.name, native);
      context.document.modelContext.getTools = async () => [{ ...native, window: context.window }];
      context.document.querySelectorAll = () => [{
        getAttribute: key => ({ toolname: native.name, tooldescription: 'Native form' })[key] ?? null,
        hasAttribute: key => key === 'toolname',
        querySelectorAll: () => [],
      }];
    },
  });
  assert.equal(tools.get(native.name), native);
  assert.equal(tools.size, 5);
  assert.equal(warnings.length, 0);
});

test('navigation rejects off-site manifest URLs and checks cancellation before committing', async () => {
  const entries = [
    { slug: 'unsafe', url: 'https://other.example/', title: 'External' },
    { slug: 'safe', url: '/safe/', title: 'Safe' },
  ];
  let approve;
  const consent = new Promise(resolve => { approve = resolve; });
  const { tools, context } = await loadClient({}, {
    fetch: async () => ({ ok: true, json: async () => ({ entries, collections: [] }) }),
    prepare(context) {
      context.document.modelContext.requestUserInteraction = ({ message }) => message.includes('External') ? true : consent;
    },
  });
  const navigate = tools.get('go_to');
  const unsafe = await navigate.execute({ slug: 'unsafe' });
  assert.equal(typeof JSON.parse(unsafe.content[0].text).error, 'string');
  const execution = new AbortController();
  const pending = navigate.execute({ slug: '/safe' }, { signal: execution.signal });
  execution.abort();
  approve(true);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(context.window.location.href, 'https://example.com/');
});

test('safeOutput respects small character budgets and handles undefined results', async () => {
  const { tools } = await loadClient({ maxOutputLength: 5, customTools: [{ ...customTool, executeBody: 'return safeOutput(params.value);' }] });
  const tool = tools.get(customTool.name);
  assert.equal((await tool.execute({ value: 'a long value' })).content[0].text.length, 5);
  assert.equal((await tool.execute({})).content[0].text, 'null');
});

test('scanned forms use the same pre-execution cancellation guard', async () => {
  let submitted = false;
  const { tools } = await loadClient({ formScanning: true }, {
    prepare(context) {
      context.document.querySelectorAll = () => [{
        getAttribute: key => ({ toolname: 'form_tool', tooldescription: 'Submit test form' })[key] ?? null,
        hasAttribute: key => key === 'toolautosubmit',
        querySelectorAll: () => [],
        requestSubmit() { submitted = true; },
      }];
    },
  });
  assert.ok(tools.has('form_tool'));
  const execution = new AbortController();
  execution.abort();
  await assert.rejects(tools.get('form_tool').execute({}, { signal: execution.signal }), { name: 'AbortError' });
  assert.equal(submitted, false);
});

test('form scanner skips empty tool attributes and strips labelable children from wrapping labels', async () => {
  const selectField = {
    id: '',
    tagName: 'SELECT',
    getAttribute: key => ({ name: 'team' })[key] ?? null,
    hasAttribute: () => false,
    querySelectorAll: () => [{ value: 'support', textContent: 'Website support' }],
    closest: () => ({
      cloneNode: () => ({
        querySelectorAll: () => [{ remove() {} }],
        textContent: ' Routing team ',
      }),
    }),
  };
  const { tools, warnings } = await loadClient({ formScanning: true }, {
    prepare(context) {
      context.document.querySelectorAll = () => [
        {
          getAttribute: key => ({ toolname: ' ', tooldescription: 'Empty name' })[key] ?? null,
          hasAttribute: () => true,
          querySelectorAll: () => [],
        },
        {
          getAttribute: key => ({ toolname: 'valid_form', tooldescription: 'Valid form' })[key] ?? null,
          hasAttribute: key => key === 'toolname',
          querySelectorAll: () => [selectField],
        },
      ];
    },
  });
  assert.equal(warnings.length, 0);
  assert.equal(tools.get('valid_form').inputSchema.properties.team.description, 'Routing team');
});
