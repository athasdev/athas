import { tokenizerWorkerClient } from "./tokenizer-worker-client";

/**
 * WASM Parser - Tree-sitter WASM-based syntax highlighting
 * Public API for WASM tokenization functionality
 */

export { parserCache } from "./cache";
export { convertToEditorToken, convertToEditorTokens } from "./converter";
export { wasmParserLoader } from "./loader";
export { tokenizeByLine, tokenizeCode, tokenizeRange } from "./tokenizer";
export type { HighlightToken, LoadedParser, ParseResult, ParserConfig } from "./types";

const PRELOAD_LANGUAGE_IDS = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "json",
  "bash",
  "markdown",
  "html",
  "css",
];

export async function initializeWasmTokenizer(): Promise<void> {
  await tokenizerWorkerClient.warmup(PRELOAD_LANGUAGE_IDS);
}
