import { BaseLanguageProvider } from "./language-provider";

export class PhpLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "php",
      displayName: "PHP",
      extensions: ["php", "phtml", "php3", "php4", "php5", "php7", "php8", "phar", "phps"],
      aliases: ["php", "PHP"],
      description: "PHP language support with syntax highlighting and IntelliSense",
    });
  }
}

export const phpLanguage = new PhpLanguageExtension();
