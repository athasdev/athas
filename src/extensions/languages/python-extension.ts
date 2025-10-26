import { BaseLanguageProvider } from "./language-provider";

export class PythonLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "python",
      displayName: "Python",
      extensions: ["py", "pyw"],
      aliases: ["py", "python3"],
      description: "Python language support",
    });
  }
}

export const pythonLanguage = new PythonLanguageExtension();
