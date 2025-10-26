import { BaseLanguageProvider } from "./language-provider";

export class SqlLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "sql",
      displayName: "SQL",
      extensions: ["sql"],
      aliases: ["sql"],
      description: "SQL language support",
    });
  }
}

export const sqlLanguage = new SqlLanguageExtension();
