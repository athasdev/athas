import { BaseLanguageProvider } from "./language-provider";

export class JavaScriptLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "javascript",
      displayName: "JavaScript",
      extensions: ["js", "jsx", "mjs", "cjs"],
      aliases: ["js", "jsx"],
      description: "JavaScript language support with JSX",
    });
  }
}

export const javascriptLanguage = new JavaScriptLanguageExtension();
