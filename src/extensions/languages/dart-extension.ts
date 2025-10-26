import { BaseLanguageProvider } from "./language-provider";

export class DartLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "dart",
      displayName: "Dart",
      extensions: ["dart"],
      aliases: ["dart"],
      description: "Dart language support",
    });
  }
}

export const dartLanguage = new DartLanguageExtension();
