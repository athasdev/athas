import { BaseLanguageProvider } from "./language-provider";

export class ErbLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "erb",
      displayName: "ERB",
      extensions: ["erb", "html.erb"],
      aliases: ["erb"],
      description: "Embedded Ruby (ERB) language support",
    });
  }
}

export const erbLanguage = new ErbLanguageExtension();
