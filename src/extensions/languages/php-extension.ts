import { BaseLanguageProvider } from "./language-provider";

export class PhpLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "php",
      displayName: "PHP",
      extensions: ["php"],
      aliases: ["php"],
      description: "PHP language support",
    });
  }
}

export const phpLanguage = new PhpLanguageExtension();
