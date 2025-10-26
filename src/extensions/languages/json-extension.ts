import { BaseLanguageProvider } from "./language-provider";

export class JsonLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "json",
      displayName: "JSON",
      extensions: ["json"],
      aliases: ["json"],
      description: "JSON language support",
    });
  }
}

export const jsonLanguage = new JsonLanguageExtension();
