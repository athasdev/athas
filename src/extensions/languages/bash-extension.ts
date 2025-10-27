import { BaseLanguageProvider } from "./language-provider";

export class BashLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "bash",
      displayName: "Bash",
      extensions: ["sh", "bash", "zsh"],
      aliases: ["shell", "bash", "sh"],
      filenames: ["Makefile", ".bashrc", ".bash_profile"],
      description: "Bash/Shell script language support",
    });
  }
}

export const bashLanguage = new BashLanguageExtension();
