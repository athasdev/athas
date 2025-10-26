import { BaseLanguageProvider } from "./language-provider";

export class CppLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "cpp",
      displayName: "C++",
      extensions: ["cpp", "cxx", "cc", "c++", "hpp", "hxx", "h++"],
      aliases: ["cpp", "c++"],
      description: "C++ language support",
    });
  }
}

export const cppLanguage = new CppLanguageExtension();
