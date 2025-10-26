import { BaseLanguageProvider } from "./language-provider";

export class CssLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "css",
      displayName: "CSS",
      extensions: ["css"],
      aliases: ["css"],
      description: "CSS language support",
    });
  }
}

export const cssLanguage = new CssLanguageExtension();
