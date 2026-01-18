import { BaseLanguageProvider } from "./language-provider";

export class RustLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "rust",
      displayName: "Rust",
      extensions: ["rs"],
      aliases: ["rust"],
      description: "Rust language support",
    });
  }
}

export const rustLanguage = new RustLanguageExtension();
