import { BaseLanguageProvider } from "./language-provider";

export class JavaLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "java",
      displayName: "Java",
      extensions: ["java"],
      aliases: ["java"],
      description: "Java language support",
    });
  }
}

export const javaLanguage = new JavaLanguageExtension();
