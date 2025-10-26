import { BaseLanguageProvider } from "./language-provider";

export class YamlLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "yaml",
      displayName: "YAML",
      extensions: ["yaml", "yml"],
      aliases: ["yaml", "yml"],
      description: "YAML language support",
    });
  }
}

export const yamlLanguage = new YamlLanguageExtension();
