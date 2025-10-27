import { BaseLanguageProvider } from "./language-provider";

export class TomlLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "toml",
      displayName: "TOML",
      extensions: ["toml"],
      aliases: ["toml"],
      description: "TOML language support",
    });
  }
}

export const tomlLanguage = new TomlLanguageExtension();
