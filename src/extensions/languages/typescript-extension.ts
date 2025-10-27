import { BaseLanguageProvider } from "./language-provider";

export class TypeScriptLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "typescript",
      displayName: "TypeScript",
      extensions: ["ts", "tsx"],
      aliases: ["ts", "tsx"],
      description: "TypeScript language support with TSX",
    });
  }
}

export const typescriptLanguage = new TypeScriptLanguageExtension();
