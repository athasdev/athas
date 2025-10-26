import { BaseLanguageProvider } from "./language-provider";

export class HtmlLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "html",
      displayName: "HTML",
      extensions: ["html", "htm"],
      aliases: ["html"],
      description: "HTML language support",
    });
  }
}

export const htmlLanguage = new HtmlLanguageExtension();
