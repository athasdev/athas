/**
 * Parser CDN Configuration
 * Maps languages to their CDN URLs with version pinning
 *
 * WASM files are served from jsdelivr (npm CDN)
 * Highlight queries are fetched from GitHub tree-sitter repos
 */

interface ParserCdnConfig {
  /** Version of tree-sitter-wasms package */
  wasmsVersion: string;
  /** Version tag of the tree-sitter grammar repo */
  grammarVersion: string;
  /** Language ID used in tree-sitter (may differ from our languageId) */
  treeSitterLangId?: string;
  /** GitHub organization (defaults to "tree-sitter") */
  githubOrg?: string;
  /** Whether to omit "v" prefix in version tag (defaults to false) */
  noVersionPrefix?: boolean;
}

/** Default version for tree-sitter-wasms package */
const WASMS_VERSION = "0.1.13";

/**
 * Version-pinned parser configurations
 * These versions must match - the WASM in tree-sitter-wasms is built from the grammar version
 */
const PARSER_VERSIONS: Record<string, ParserCdnConfig> = {
  // Core languages
  json: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.2" },
  python: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.21.0" },
  go: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.0" },
  rust: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.4" },
  java: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.2" },

  // C family
  c: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.8" },
  cpp: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.5" },
  c_sharp: {
    wasmsVersion: WASMS_VERSION,
    grammarVersion: "0.20.0",
    treeSitterLangId: "c-sharp",
  },

  // Web
  html: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.4" },
  css: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.0" },
  php: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.22.8" },

  // Scripting
  bash: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.5" },
  ruby: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.1" },

  // Config files
  toml: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.5.1" },

  // Other languages with different GitHub orgs
  kotlin: {
    wasmsVersion: WASMS_VERSION,
    grammarVersion: "0.3.8",
    githubOrg: "fwcd",
    noVersionPrefix: true,
  },
  swift: {
    wasmsVersion: WASMS_VERSION,
    grammarVersion: "0.4.3",
    githubOrg: "alex-pinkus",
    noVersionPrefix: true,
  },
  elixir: {
    wasmsVersion: WASMS_VERSION,
    grammarVersion: "0.1.1",
    githubOrg: "elixir-lang",
  },
  zig: {
    wasmsVersion: WASMS_VERSION,
    grammarVersion: "1.1.2",
    githubOrg: "tree-sitter-grammars",
  },
  ocaml: { wasmsVersion: WASMS_VERSION, grammarVersion: "0.20.4" },
};

/**
 * Get CDN URL for a language's WASM parser
 * Uses jsdelivr which serves npm packages
 */
export function getWasmCdnUrl(languageId: string): string | null {
  const config = PARSER_VERSIONS[languageId];
  if (!config) return null;

  const treeSitterLangId = config.treeSitterLangId || languageId;
  return `https://cdn.jsdelivr.net/npm/tree-sitter-wasms@${config.wasmsVersion}/out/tree-sitter-${treeSitterLangId}.wasm`;
}

/**
 * Get CDN URL for a language's highlight query
 * Uses raw GitHub URLs from tree-sitter repos
 */
export function getQueryCdnUrl(languageId: string): string | null {
  const config = PARSER_VERSIONS[languageId];
  if (!config) return null;

  const treeSitterLangId = config.treeSitterLangId || languageId;
  const githubOrg = config.githubOrg || "tree-sitter";
  const versionTag = config.noVersionPrefix ? config.grammarVersion : `v${config.grammarVersion}`;

  return `https://raw.githubusercontent.com/${githubOrg}/tree-sitter-${treeSitterLangId}/${versionTag}/queries/highlights.scm`;
}

/**
 * Check if a language has CDN configuration
 */
export function hasCdnConfig(languageId: string): boolean {
  return languageId in PARSER_VERSIONS;
}

/**
 * Get all languages with CDN support
 */
export function getCdnSupportedLanguages(): string[] {
  return Object.keys(PARSER_VERSIONS);
}
