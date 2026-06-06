# astro-webmcp

Integração Astro que expõe automaticamente o conteúdo do seu site via [WebMCP](https://developer.chrome.com/docs/ai/webmcp) — permitindo que agentes de IA descubram, busquem e naveguem pelo conteúdo diretamente no browser.

## O que é WebMCP?

WebMCP é um padrão web proposto pelo Chrome que permite sites declararem "tools" estruturadas para agentes de IA. Em vez de um agente interpretar visualmente cada elemento da página, o site declara explicitamente o que pode ser feito — buscar artigos, navegar para seções, preencher formulários.

- **Spec:** https://webmachinelearning.github.io/webmcp/
- **Chrome docs:** https://developer.chrome.com/docs/ai/webmcp
- **GitHub:** https://github.com/webmachinelearning/webmcp

## O que este plugin faz

1. **No build**: lê suas Content Collections do Astro e gera um manifesto JSON com metadados (título, slug, descrição, tags)
2. **No browser**: injeta um script que registra tools WebMCP via `document.modelContext.registerTool()`
3. **Agentes** visitando qualquer página do site descobrem automaticamente tools para buscar e navegar pelo conteúdo

### Tools expostas

| Tool | Descrição |
|------|-----------|
| `search_content` | Busca artigos/páginas por palavra-chave |
| `list_sections` | Lista collections/seções disponíveis |
| `go_to` | Navega para uma página específica pelo slug |
| `get_page_info` | Retorna metadados da página atual (título, descrição, headings) |

## Instalação

```bash
npm install astro-webmcp
```

## Uso básico

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import webmcp from 'astro-webmcp';

export default defineConfig({
  integrations: [webmcp()],
});
```

Com opções:

```js
webmcp({
  collections: ['blog', 'docs'], // filtrar collections (default: todas)
})
```

## Requisitos

- Astro 6+
- Chrome 149+ com flag `chrome://flags/#enable-webmcp-testing` (ou origin trial)
- Documento origin-isolated (padrão do Astro)

## Testar

Instale a extensão [Model Context Tool Inspector](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd) para simular um agente chamando seus tools.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Guia de uso](docs/usage.md)
- [Publicação no npm](docs/publishing.md)

## Status

🚧 Em desenvolvimento — WebMCP ainda é um padrão em evolução (developer trial no Chrome).

## Licença

MIT
