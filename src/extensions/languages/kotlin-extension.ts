import { BaseLanguageProvider } from "./language-provider";

export class KotlinLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "kotlin",
      displayName: "Kotlin",
      extensions: ["kt", "kts"],
      aliases: ["kotlin"],
      description: "Kotlin language support",
    });
  }
}

export const kotlinLanguage = new KotlinLanguageExtension();
