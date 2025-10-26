import { BaseLanguageProvider } from "./language-provider";

export class RubyLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "ruby",
      displayName: "Ruby",
      extensions: ["rb", "ruby"],
      aliases: ["rb"],
      description: "Ruby language support",
    });
  }
}

export const rubyLanguage = new RubyLanguageExtension();
