import { BaseLanguageProvider } from "./language-provider";

export class GoLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "go",
      displayName: "Go",
      extensions: ["go"],
      aliases: ["golang"],
      description: "Go language support",
    });
  }
}

export const goLanguage = new GoLanguageExtension();
