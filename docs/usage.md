# Guia de uso — astro-webmcp

## Instalação

```bash
npm install astro-webmcp
```

## Configuração mínima

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import webmcp from 'astro-webmcp';

export default defineConfig({
  integrations: [webmcp()],
});
```

Isso expõe todo o conteúdo do site via WebMCP automaticamente.

## Opções de configuração

```js
webmcp({
  // Filtrar quais collections expor (default: todas)
  collections: ['blog', 'docs'],
})
```

| Opção | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `collections` | `string[]` | `undefined` (todas) | Lista de collections para incluir no manifesto |

## Como funciona no browser

Após o build, toda página do site inclui um script leve (~1KB) que:

1. Verifica se o browser suporta WebMCP (`'modelContext' in document`)
2. Se não suporta, sai imediatamente — zero impacto
3. Se suporta, carrega `/_webmcp/manifest.json` e registra tools

### Tools registradas automaticamente

#### `search_content`

Busca conteúdo do site por palavra-chave.

```json
{
  "name": "search_content",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Termo de busca" },
      "collection": { "type": "string", "description": "Filtrar por collection (opcional)" },
      "limit": { "type": "number", "description": "Máximo de resultados (padrão: 5)" }
    },
    "required": ["query"]
  }
}
```

**Exemplo de uso por agente:** "Busque artigos sobre TypeScript no blog"

#### `list_sections`

Lista as seções/collections disponíveis no site.

```json
{
  "name": "list_sections",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**Exemplo:** "Quais seções de conteúdo este site tem?"

#### `go_to`

Navega para uma página específica.

```json
{
  "name": "go_to",
  "inputSchema": {
    "type": "object",
    "properties": {
      "slug": { "type": "string", "description": "Slug/caminho da página" }
    },
    "required": ["slug"]
  }
}
```

**Exemplo:** "Abra o artigo sobre WebMCP"

## Testar localmente

### 1. Habilitar WebMCP no Chrome

Navegue até `chrome://flags/#enable-webmcp-testing` → **Enabled** → Relaunch.

### 2. Instalar a extensão de teste

[Model Context Tool Inspector](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd)

### 3. Verificar tools no DevTools

Abra DevTools → Console:

```js
const tools = await document.modelContext.getTools();
console.log(tools);
// [{name: "search_content", ...}, {name: "list_sections", ...}, {name: "go_to", ...}]
```

### 4. Testar um tool manualmente

```js
const tools = await document.modelContext.getTools();
const searchTool = tools.find(t => t.name === 'search_content');
const result = await document.modelContext.executeTool(searchTool, '{"query": "astro"}');
console.log(result);
```

## Combinando com Declarative API

O plugin usa a Imperative API para busca e navegação. Para formulários existentes no site, você pode adicionar a Declarative API manualmente — as duas coexistem:

```astro
---
// src/pages/contato.astro
---
<form toolname="send_message"
      tooldescription="Envia uma mensagem de contato."
      toolautosubmit
      action="/api/contact">
  <label for="email">Email</label>
  <input type="email" name="email" required>

  <label for="message">Mensagem</label>
  <textarea name="message" required></textarea>

  <button type="submit">Enviar</button>
</form>
```

O agente verá **ambos** os tools da integração + os tools declarativos dos formulários.

## Manifesto gerado

Após o build, o arquivo `dist/_webmcp/manifest.json` contém:

```json
{
  "collections": [
    { "name": "blog", "count": 12 },
    { "name": "docs", "count": 8 }
  ],
  "entries": [
    {
      "slug": "blog/introducao-webmcp",
      "url": "/blog/introducao-webmcp/",
      "title": "Introdução ao WebMCP",
      "description": "Como expor conteúdo para agentes de IA",
      "collection": "blog",
      "tags": ["webmcp", "ai"]
    }
  ]
}
```

## Compatibilidade

| Browser | Suporte |
|---------|---------|
| Chrome 149+ | ✅ (flag ou origin trial) |
| Outros browsers | ❌ (script não executa, zero impacto) |

O plugin é um **progressive enhancement** — sites continuam funcionando normalmente em browsers sem suporte.

## Troubleshooting

### Tools não aparecem

1. Verifique que a flag `chrome://flags/#enable-webmcp-testing` está habilitada
2. Confira no Network tab que `/_webmcp/manifest.json` retorna 200
3. No Console, verifique `'modelContext' in document` → deve ser `true`

### Manifesto vazio

- Confirme que o build completou sem erros
- Verifique que suas Content Collections estão definidas em `src/content/config.ts`

### Busca não retorna resultados

- A busca é case-insensitive nos campos `title`, `description` e `tags`
- Se não tem `description` no frontmatter, só busca no `title`
