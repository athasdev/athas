/**
 * WASM Parser - Tree-sitter WASM-based syntax highlighting
 * Public API for WASM tokenization functionality
 */

export { convertToEditorTokens } from "./converter";
export { wasmParserLoader } from "./loader";
export { tokenizeCode } from "./tokenizer";
