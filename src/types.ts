/** Opções de configuração do astro-webmcp */
export interface WebMCPOptions {
  /** Collections a expor (default: todas as que tiverem páginas) */
  collections?: string[];
  /** Tools customizados adicionais */
  customTools?: CustomTool[];
}

/** Tool customizado definido pelo usuário */
export interface CustomTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Corpo da função execute serializado (roda no browser) */
  executeBody: string;
}

/** Entrada no manifesto gerado */
export interface ManifestEntry {
  slug: string;
  url: string;
  title: string;
  description?: string;
  collection?: string;
  tags?: string[];
}

/** Manifesto completo gerado no build */
export interface WebMCPManifest {
  generatedAt: string;
  site?: string;
  collections: Array<{ name: string; count: number }>;
  entries: ManifestEntry[];
}
