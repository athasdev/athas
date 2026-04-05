/**
 * WASM Tokenizer
 * Provides tokenization API using Tree-sitter WASM parsers
 */

import type { Node, Tree } from "web-tree-sitter";
import { logger } from "../../utils/logger";
import { getDefaultParserWasmUrl } from "./extension-assets";
import { wasmParserLoader } from "./loader";
import type {
  HighlightToken,
  IncrementalParseOptions,
  LoadedParser,
  ParserConfig,
  TokenizeResult,
} from "./types";

/**
 * Language injection rules for embedded languages (e.g. JS inside HTML <script>)
 */
interface InjectionRule {
  parentType: string;
  contentType: string;
  language: string;
}

const LANGUAGE_INJECTIONS: Record<string, InjectionRule[]> = {
  html: [
    { parentType: "script_element", contentType: "raw_text", language: "javascript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
  ],
  svelte: [
    { parentType: "script_element", contentType: "raw_text", language: "javascript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
    { parentType: "*", contentType: "raw_text_await", language: "javascript" },
    { parentType: "*", contentType: "raw_text_each", language: "javascript" },
    { parentType: "*", contentType: "raw_text_expr", language: "javascript" },
  ],
  markdown: [{ parentType: "*", contentType: "html_block", language: "html" }],
};

/**
 * Walk the tree to find nodes matching injection rules
 */
function findInjectionNodes(
  rootNode: Node,
  rules: InjectionRule[],
): Array<{ rule: InjectionRule; node: Node; parentNode: Node | null }> {
  const results: Array<{ rule: InjectionRule; node: Node; parentNode: Node | null }> = [];

  function walk(node: Node) {
    for (const rule of rules) {
      if (rule.parentType === "*") {
        if (node.type === rule.contentType) {
          results.push({ rule, node, parentNode: null });
        }
      } else if (node.type === rule.parentType) {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type === rule.contentType) {
            results.push({ rule, node: child, parentNode: node });
          }
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(rootNode);
  return results;
}

function resolveInjectedLanguage(
  source: string,
  parentLanguageId: string,
  rule: InjectionRule,
  node: Node,
  parentNode: Node | null,
): string {
  if (rule.parentType !== "script_element" || !parentNode) {
    return rule.language;
  }

  const openingTag = source.slice(parentNode.startIndex, node.startIndex);
  const langMatch = openingTag.match(/\blang\s*=\s*["']([^"']+)["']/i);
  const lang = langMatch?.[1]?.trim().toLowerCase();

  if (!lang) {
    return rule.language;
  }

  if (lang === "ts" || lang === "typescript") {
    return "typescript";
  }

  if (lang === "js" || lang === "javascript") {
    return "javascript";
  }

  if (parentLanguageId === "svelte" && (lang === "tsx" || lang === "jsx")) {
    return lang === "tsx" ? "typescriptreact" : "javascriptreact";
  }

  return rule.language;
}

/**
 * Map Tree-sitter capture names to CSS class names
 */
const CAPTURE_TO_CLASS: Record<string, string> = {
  // Keywords
  keyword: "token-keyword",
  "keyword.control": "token-keyword",
  "keyword.function": "token-keyword",
  "keyword.operator": "token-keyword",
  "keyword.return": "token-keyword",
  "keyword.import": "token-keyword",
  "keyword.conditional": "token-keyword",
  "keyword.conditional.ternary": "token-operator",
  "keyword.repeat": "token-keyword",
  "keyword.type": "token-keyword",
  "keyword.coroutine": "token-keyword",
  "keyword.exception": "token-keyword",
  "keyword.modifier": "token-keyword",
  "keyword.directive": "token-keyword",

  // Functions
  function: "token-function",
  "function.call": "token-function",
  "function.method": "token-function",
  "function.method.call": "token-function",
  "function.builtin": "token-function",
  method: "token-function",
  "method.call": "token-function",
  constructor: "token-function",

  // Variables
  variable: "token-variable",
  "variable.builtin": "token-variable",
  "variable.parameter": "token-variable",
  "variable.member": "token-property",
  parameter: "token-variable",

  // Constants
  constant: "token-constant",
  "constant.builtin": "token-constant",
  "constant.numeric": "token-number",
  number: "token-number",
  float: "token-number",
  boolean: "token-constant",

  // Strings
  string: "token-string",
  "string.special": "token-string",
  "string.special.key": "token-property",
  "string.special.url": "token-string",
  "string.escape": "token-string",
  "string.regexp": "token-string",
  character: "token-string",
  "character.special": "token-string",

  // Comments
  comment: "token-comment",
  "comment.line": "token-comment",
  "comment.block": "token-comment",
  "comment.documentation": "token-comment",

  // Types
  type: "token-type",
  "type.builtin": "token-type",
  "type.definition": "token-type",
  class: "token-type",
  interface: "token-type",
  enum: "token-type",
  struct: "token-type",

  // Properties
  property: "token-property",
  "property.definition": "token-property",
  attribute: "token-attribute",
  field: "token-property",

  // Tags (HTML/XML/JSX)
  tag: "token-tag",
  "tag.builtin": "token-tag",
  "tag.attribute": "token-attribute",
  "tag.delimiter": "token-punctuation",

  // Operators
  operator: "token-operator",
  "operator.arithmetic": "token-operator",
  "operator.logical": "token-operator",

  // Punctuation
  punctuation: "token-punctuation",
  "punctuation.delimiter": "token-punctuation",
  "punctuation.bracket": "token-punctuation",
  "punctuation.special": "token-punctuation",

  // Markup (MDX, HTML semantic content)
  "markup.heading": "token-keyword",
  "markup.heading.1": "token-keyword",
  "markup.heading.2": "token-keyword",
  "markup.heading.3": "token-keyword",
  "markup.heading.4": "token-keyword",
  "markup.heading.5": "token-keyword",
  "markup.heading.6": "token-keyword",
  "markup.strong": "token-constant",
  "markup.italic": "token-variable",
  "markup.strikethrough": "token-comment",
  "markup.underline": "token-string",
  "markup.raw": "token-string",
  "markup.link.label": "token-string",

  // Misc
  label: "token-constant",
  namespace: "token-type",
  module: "token-type",
  "module.builtin": "token-type",
  decorator: "token-attribute",
  annotation: "token-attribute",
  macro: "token-function",

  // Markdown (legacy)
  "text.title": "token-keyword",
  "text.literal": "token-string",
  "text.emphasis": "token-variable",
  "text.strong": "token-constant",
  "text.uri": "token-string",
  "text.reference": "token-function",
  none: "token-text",
};

/**
 * Get CSS class name for a Tree-sitter capture name
 */
function mapCaptureToClass(captureName: string): string {
  const exact = CAPTURE_TO_CLASS[captureName];
  if (exact) return exact;
  // Prefix fallback: "keyword.conditional.ternary" → "keyword.conditional" → "keyword"
  const dot = captureName.lastIndexOf(".");
  if (dot > 0) return mapCaptureToClass(captureName.substring(0, dot));
  return "token-text";
}

/**
 * Tokenize code using a WASM parser with optional incremental parsing support.
 * Returns both tokens and the parse tree for caching.
 */
export async function tokenizeCodeWithTree(
  content: string,
  languageId: string,
  config?: ParserConfig,
  incrementalOptions?: IncrementalParseOptions,
): Promise<TokenizeResult> {
  try {
    // Load parser if not already loaded
    let loadedParser: LoadedParser;
    if (config) {
      loadedParser = await wasmParserLoader.loadParser(config);
    } else if (wasmParserLoader.isLoaded(languageId)) {
      // Use already loaded parser
      loadedParser = wasmParserLoader.getParser(languageId);
    } else {
      // Try to load from IndexedDB cache
      const { indexedDBParserCache } = await import("./cache-indexeddb");
      const cached = await indexedDBParserCache.get(languageId);

      if (cached) {
        // Load parser from cache
        logger.debug("WasmTokenizer", `Loading ${languageId} from IndexedDB cache`);
        loadedParser = await wasmParserLoader.loadParser({
          languageId,
          wasmPath: cached.sourceUrl || `indexeddb://${languageId}`, // wasmPath not used when cached
          highlightQuery: cached.highlightQuery,
        });
      } else {
        throw new Error(`Parser for ${languageId} is not loaded and not found in cache`);
      }
    }

    const { parser, highlightQuery } = loadedParser;

    let tree: Tree | null;

    // Use incremental parsing if previous tree and edit are provided
    if (incrementalOptions?.previousTree && incrementalOptions?.edit) {
      try {
        // Copy the tree before editing to avoid mutating the cached tree
        const treeCopy = incrementalOptions.previousTree.copy();
        // Apply the edit to the copy
        treeCopy.edit(incrementalOptions.edit);
        // Parse incrementally using the edited copy
        tree = parser.parse(content, treeCopy);
        // Clean up the copy (the new tree is independent)
        treeCopy.delete();
      } catch (error) {
        // Fall back to full parse if incremental fails
        logger.warn("WasmTokenizer", "Incremental parse failed, falling back to full parse", error);
        tree = parser.parse(content);
      }
    } else {
      // Full parse
      tree = parser.parse(content);
    }

    // Check if parse was successful
    if (!tree) {
      logger.error("WasmTokenizer", `Failed to parse code for ${languageId}`);
      return { tokens: [], tree: null as unknown as TokenizeResult["tree"] };
    }

    // If no highlight query, return empty tokens but keep tree
    if (!highlightQuery) {
      logger.warn(
        "WasmTokenizer",
        `No highlight query for ${languageId} - syntax highlighting disabled. ` +
          `Ensure the highlight query was downloaded with the extension.`,
      );
      return { tokens: [], tree };
    }

    // Get highlights
    const captures = highlightQuery.captures(tree.rootNode);

    // Convert captures to tokens, filtering out Neovim-specific metadata
    // captures that don't correspond to visual highlighting
    const tokens: HighlightToken[] = [];
    for (const capture of captures) {
      const { name } = capture;
      if (name === "none" || name === "spell" || name.startsWith("_")) {
        continue;
      }
      const { node } = capture;
      tokens.push({
        type: mapCaptureToClass(name),
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        startPosition: {
          row: node.startPosition.row,
          column: node.startPosition.column,
        },
        endPosition: {
          row: node.endPosition.row,
          column: node.endPosition.column,
        },
      });
    }

    // Process language injections (e.g. JS inside HTML <script>)
    const injectionRules = LANGUAGE_INJECTIONS[languageId];
    if (injectionRules) {
      const injectionNodes = findInjectionNodes(tree.rootNode, injectionRules);

      for (const { rule, node, parentNode } of injectionNodes) {
        try {
          const embeddedContent = content.substring(node.startIndex, node.endIndex);
          if (!embeddedContent.trim()) continue;

          const embeddedLanguageId = resolveInjectedLanguage(
            content,
            languageId,
            rule,
            node,
            parentNode,
          );
          const wasmPath = getDefaultParserWasmUrl(embeddedLanguageId);
          const subTokens = await tokenizeCode(embeddedContent, embeddedLanguageId, {
            languageId: embeddedLanguageId,
            wasmPath,
          });

          const startOffset = node.startIndex;
          const startRow = node.startPosition.row;
          const startCol = node.startPosition.column;

          for (const token of subTokens) {
            if (token.startPosition.row === 0) {
              token.startPosition.column += startCol;
            }
            if (token.endPosition.row === 0) {
              token.endPosition.column += startCol;
            }
            token.startPosition.row += startRow;
            token.endPosition.row += startRow;
            token.startIndex += startOffset;
            token.endIndex += startOffset;
          }

          tokens.push(...subTokens);
        } catch (error) {
          logger.warn(
            "WasmTokenizer",
            `Failed to tokenize embedded ${rule.language} in ${languageId}`,
            error,
          );
        }
      }
    }

    // Deduplicate tokens at the same range. Tree-sitter returns captures in
    // pattern order for same-position nodes; later patterns are more specific
    // (e.g. @tag.builtin overrides @variable). Keep the last capture per range.
    const deduped: HighlightToken[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const next = tokens[i + 1];
      if (
        next &&
        next.startIndex === tokens[i].startIndex &&
        next.endIndex === tokens[i].endIndex
      ) {
        continue;
      }
      deduped.push(tokens[i]);
    }

    return { tokens: deduped, tree };
  } catch (error) {
    logger.error("WasmTokenizer", `Failed to tokenize code for ${languageId}`, error);
    throw error;
  }
}

/**
 * Tokenize code using a WASM parser (legacy function, returns only tokens)
 */
export async function tokenizeCode(
  content: string,
  languageId: string,
  config?: ParserConfig,
): Promise<HighlightToken[]> {
  const result = await tokenizeCodeWithTree(content, languageId, config);
  // Delete the tree since caller doesn't need it
  if (result.tree) {
    try {
      result.tree.delete();
    } catch {
      // Tree may already be deleted
    }
  }
  return result.tokens;
}

/**
 * Tokenize a specific range of lines
 */
export async function tokenizeRange(
  content: string,
  languageId: string,
  startLine: number,
  endLine: number,
  config?: ParserConfig,
): Promise<HighlightToken[]> {
  // For WASM, we parse the full document and filter tokens
  // Tree-sitter doesn't support partial parsing easily
  const allTokens = await tokenizeCode(content, languageId, config);

  // Filter tokens within the line range
  return allTokens.filter((token) => {
    return token.startPosition.row >= startLine && token.endPosition.row <= endLine;
  });
}

/**
 * Tokenize code by line
 * Returns tokens grouped by line number
 */
export async function tokenizeByLine(
  content: string,
  languageId: string,
  config?: ParserConfig,
): Promise<Map<number, HighlightToken[]>> {
  const allTokens = await tokenizeCode(content, languageId, config);
  const tokensByLine = new Map<number, HighlightToken[]>();

  for (const token of allTokens) {
    // A token might span multiple lines
    for (let line = token.startPosition.row; line <= token.endPosition.row; line++) {
      if (!tokensByLine.has(line)) {
        tokensByLine.set(line, []);
      }
      tokensByLine.get(line)!.push(token);
    }
  }

  return tokensByLine;
}

/**
 * Initialize the WASM tokenizer
 */
export async function initializeWasmTokenizer(): Promise<void> {
  await wasmParserLoader.initialize();
  logger.info("WasmTokenizer", "WASM tokenizer initialized");
}
