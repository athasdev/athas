import { BaseLanguageProvider } from "./language-provider";

export class ElixirLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "elixir",
      displayName: "Elixir",
      extensions: ["ex", "exs"],
      aliases: ["elixir"],
      description: "Elixir language support",
    });
  }
}

export const elixirLanguage = new ElixirLanguageExtension();
