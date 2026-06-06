# Arquitetura — astro-webmcp

## Visão geral

```
┌─────────────────────────────────────────────────────────┐
│                     BUILD TIME                           │
│                                                         │
│  Content Collections ──→ Hook astro:build:done          │
│  (blog, docs, etc.)      │                              │
│                           ▼                              │
│                    Manifesto JSON                        │
│                    /_webmcp/manifest.json                │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     RUNTIME (Browser)                    │
│                                                         │
│  Script injetado (injectScript)                         │
│       │                                                 │
│       ├─ fetch('/_webmcp/manifest.json')                │
│       │                                                 │
│       └─ document.modelContext.registerTool()           │
│            ├── search_content                           │
│            ├── list_sections                            │
│            └── go_to                                    │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     AGENTE DE IA                         │
│                                                         │
│  Chrome (149+) descobre tools via WebMCP protocol       │
│  Agente pode buscar, listar e navegar pelo conteúdo     │
└─────────────────────────────────────────────────────────┘
```

## Componentes

### 1. Integração Astro (`src/index.ts`)

Implementa a interface `AstroIntegration` com dois hooks principais:

#### `astro:config:setup`

- Usa `injectScript('page', ...)` para inserir o script client-side em toda página
- O script faz feature detection (`'modelContext' in document`) antes de registrar tools
- Carrega o manifesto via `fetch` e registra tools com `document.modelContext.registerTool()`

#### `astro:build:done`

- Recebe `dir` (diretório de output) e `pages` (lista de páginas geradas)
- Gera `/_webmcp/manifest.json` com metadados de cada página
- Extrai informações de collections quando disponíveis

### 2. Manifesto (`/_webmcp/manifest.json`)

Arquivo JSON estático gerado no build com a estrutura:

```json
{
  "collections": [
    { "name": "blog", "count": 42 },
    { "name": "docs", "count": 15 }
  ],
  "entries": [
    {
      "slug": "blog/meu-artigo",
      "url": "/blog/meu-artigo/",
      "title": "Meu Artigo",
      "description": "Resumo do artigo",
      "collection": "blog",
      "tags": ["astro", "webmcp"]
    }
  ]
}
```

### 3. Script client-side

Roda no browser em toda página. Responsável por:

1. Verificar suporte a WebMCP (`'modelContext' in document`)
2. Buscar o manifesto
3. Registrar 3 tools padrão

O script é minúsculo (~1KB gzipped) e não impacta performance para browsers sem suporte — sai na primeira checagem.

## APIs WebMCP utilizadas

| API | Uso |
|-----|-----|
| `document.modelContext.registerTool()` | Registra cada tool com nome, descrição, schema e executor |
| `inputSchema` (JSON Schema) | Define parâmetros tipados para os agentes |
| `execute` (async function) | Lógica executada quando agente chama o tool |

Referência: https://developer.chrome.com/docs/ai/webmcp/imperative-api

## Decisões de design

### Por que manifesto JSON e não virtual module?

- Funciona tanto em SSG quanto SSR
- Não precisa de plugin Vite complexo
- Cache-friendly (arquivo estático servido pelo CDN)
- Pode ser pré-gerado por CI sem rodar o Astro completo

### Por que busca client-side?

- Sites pequenos/médios (<1000 páginas): manifesto leve, busca instantânea
- Não requer endpoint server-side
- Para sites grandes: futura opção de endpoint `/api/webmcp-search` via middleware

### Por que Imperative API (não Declarative)?

- Declarative API funciona só para formulários existentes
- Busca e navegação não são formulários — precisam de lógica JS
- Imperative dá controle total sobre o que o tool faz

## Extensibilidade futura

- **Tools customizados via config** — permitir o dev adicionar tools próprios
- **Busca full-text** — integrar com Pagefind ou similar ao invés de busca simples no manifesto
- **Declarative automático** — detectar `<form>` e injetar `toolname` via rehype plugin
- **Estado da página** — expor contexto dinâmico (artigo atual, breadcrumb, filtros ativos)
