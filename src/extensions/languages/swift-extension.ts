import { BaseLanguageProvider } from "./language-provider";

export class SwiftLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "swift",
      displayName: "Swift",
      extensions: ["swift"],
      aliases: ["swift"],
      description: "Swift language support",
    });
  }
}

export const swiftLanguage = new SwiftLanguageExtension();
