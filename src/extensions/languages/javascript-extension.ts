import { BaseLanguageProvider } from "./language-provider";

export class JavaScriptLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "javascript",
      displayName: "JavaScript",
      extensions: ["js", "jsx", "mjs", "cjs"],
      aliases: ["js", "jsx"],
      description: "JavaScript language support with JSX",
      // Use tsx parser since it supports JavaScript/JSX
      wasmPath: "/tree-sitter/parsers/tree-sitter-tsx.wasm",
      highlightQueryPath: "/tree-sitter/queries/tsx/highlights.scm",
    });
  }
}

export const javascriptLanguage = new JavaScriptLanguageExtension();
