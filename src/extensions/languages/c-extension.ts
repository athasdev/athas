import { BaseLanguageProvider } from "./language-provider";

export class CLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "c",
      displayName: "C",
      extensions: ["c", "h"],
      aliases: ["c"],
      description: "C language support",
    });
  }
}

export const cLanguage = new CLanguageExtension();
