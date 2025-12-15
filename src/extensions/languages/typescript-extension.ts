import { BaseLanguageProvider } from "./language-provider";

export class TypeScriptLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "typescript",
      displayName: "TypeScript",
      extensions: ["ts", "tsx", "mts", "cts"],
      aliases: ["ts", "tsx"],
      description: "TypeScript language support with TSX",
      wasmPath: "/tree-sitter/parsers/tree-sitter-tsx.wasm",
      highlightQueryPath: "/tree-sitter/queries/tsx/highlights.scm",
    });
  }
}

export const typescriptLanguage = new TypeScriptLanguageExtension();
