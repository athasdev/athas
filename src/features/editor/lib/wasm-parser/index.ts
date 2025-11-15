/**
 * WASM Parser - Tree-sitter WASM-based syntax highlighting
 * Entry point for WASM tokenization functionality
 */

export { parserCache } from "./cache";
export { convertToEditorToken, convertToEditorTokens } from "./converter";
export { wasmParserLoader } from "./loader";
export {
  initializeWasmTokenizer,
  tokenizeByLine,
  tokenizeCode,
  tokenizeRange,
} from "./tokenizer";
export type {
  HighlightToken,
  LoadedParser,
  ParseResult,
  ParserConfig,
} from "./types";
