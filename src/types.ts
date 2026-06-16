/** Opções de configuração do astro-webmcp */
export interface WebMCPOptions {
  /** Collections a expor (default: todas as que tiverem páginas) */
  collections?: string[];
  /** Tools customizados adicionais */
  customTools?: CustomTool[];
  /** Opções de segurança */
  security?: SecurityOptions;
}

/** Opções de segurança do WebMCP (baseado em Chrome Agent Security Guidelines) */
export interface SecurityOptions {
  /**
   * Origens permitidas para acessar as tools via exposedTo.
   * Default: undefined (apenas same-origin, mais seguro).
   * @see https://developer.chrome.com/docs/ai/webmcp/secure-tools
   */
  exposedTo?: string[];
  /**
   * Limite máximo de caracteres no output de cada tool.
   * Previne context window overflow e reduz superfície para prompt injection.
   * Default: 1500 (recomendação Chrome: 1.5K chars por output)
   */
  maxOutputLength?: number;
  /**
   * Ativa sanitização de outputs para mitigar indirect prompt injection.
   * Remove padrões que parecem instruções para LLMs no conteúdo.
   * Default: true
   */
  sanitizeOutputs?: boolean;
}

/** Tool customizado definido pelo usuário */
export interface CustomTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Corpo da função execute serializado (roda no browser) */
  executeBody: string;
  /** Annotations de segurança */
  annotations?: ToolAnnotations;
}

/** Annotations de segurança para tools WebMCP */
export interface ToolAnnotations {
  /** Tool não altera estado (default: true para tools built-in) */
  readOnlyHint?: boolean;
  /** Output pode conter conteúdo não-confiável (UGC, dados externos) */
  untrustedContentHint?: boolean;
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
