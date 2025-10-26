import { BaseLanguageProvider } from "./language-provider";

export class CSharpLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "csharp",
      displayName: "C#",
      extensions: ["cs"],
      aliases: ["csharp", "c#"],
      description: "C# language support",
    });
  }
}

export const csharpLanguage = new CSharpLanguageExtension();
