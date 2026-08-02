import { tokenizerWorkerClient } from "./tokenizer-worker-client";

/**
 * WASM Parser - Tree-sitter WASM-based syntax highlighting
 * Public API for WASM tokenization functionality
 */

export { convertToEditorTokens } from "./converter";
export { wasmParserLoader } from "./loader";
export { tokenizeCode } from "./tokenizer";

const PRELOAD_LANGUAGE_IDS = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "json",
  "bash",
  "dotenv",
  "markdown",
  "html",
  "angular",
  "css",
];

export async function initializeWasmTokenizer(): Promise<void> {
  await tokenizerWorkerClient.warmup(PRELOAD_LANGUAGE_IDS);
}
