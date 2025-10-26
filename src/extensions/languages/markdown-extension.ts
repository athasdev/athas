import { BaseLanguageProvider } from "./language-provider";

export class MarkdownLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "markdown",
      displayName: "Markdown",
      extensions: ["md", "markdown"],
      aliases: ["markdown", "md"],
      description: "Markdown language support",
    });
  }
}

export const markdownLanguage = new MarkdownLanguageExtension();
