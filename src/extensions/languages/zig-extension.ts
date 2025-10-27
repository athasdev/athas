import { BaseLanguageProvider } from "./language-provider";

export class ZigLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "zig",
      displayName: "Zig",
      extensions: ["zig"],
      aliases: ["zig"],
      description: "Zig language support",
    });
  }
}

export const zigLanguage = new ZigLanguageExtension();
