/** Configuration options for astro-webmcp */
export interface WebMCPOptions {
  /** Collections to expose (default: all that have pages) */
  collections?: string[];
  /** Additional custom tools */
  customTools?: CustomTool[];
  /** Security options */
  security?: SecurityOptions;
}

/** Security options (based on Chrome Agent Security Guidelines) */
export interface SecurityOptions {
  /**
   * Origins allowed to access tools via exposedTo.
   * Default: undefined (same-origin only, most secure).
   * @see https://developer.chrome.com/docs/ai/webmcp/secure-tools
   */
  exposedTo?: string[];
  /**
   * Maximum character limit per tool output.
   * Prevents context window overflow and reduces prompt injection surface.
   * Default: 1500 (Chrome recommendation: 1.5K chars per output)
   */
  maxOutputLength?: number;
  /**
   * Enables output sanitization to mitigate indirect prompt injection.
   * Strips patterns that resemble LLM instructions from content.
   * Default: true
   */
  sanitizeOutputs?: boolean;
}

/** User-defined custom tool */
export interface CustomTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Serialized execute function body (runs in browser) */
  executeBody: string;
  /** Security annotations */
  annotations?: ToolAnnotations;
}

/** Security annotations for WebMCP tools */
export interface ToolAnnotations {
  /** Tool does not mutate state (default: true for built-in tools) */
  readOnlyHint?: boolean;
  /** Output may contain untrusted content (UGC, external data) */
  untrustedContentHint?: boolean;
}

/** Entry in the generated manifest */
export interface ManifestEntry {
  slug: string;
  url: string;
  title: string;
  description?: string;
  collection?: string;
  tags?: string[];
}

/** Full manifest generated at build time */
export interface WebMCPManifest {
  generatedAt: string;
  site?: string;
  collections: Array<{ name: string; count: number }>;
  entries: ManifestEntry[];
}
