// Existing languages

export { bashLanguage } from "./bash-extension";
export { cLanguage } from "./c-extension";
export { cppLanguage } from "./cpp-extension";
export { cssLanguage } from "./css-extension";
export { erbLanguage } from "./erb-extension";
export { goLanguage } from "./go-extension";
export { htmlLanguage } from "./html-extension";
export { javaLanguage } from "./java-extension";
export { javascriptLanguage } from "./javascript-extension";
export { jsonLanguage } from "./json-extension";
export { markdownLanguage } from "./markdown-extension";
export { phpLanguage } from "./php-extension";
export { pythonLanguage } from "./python-extension";
export { rubyLanguage } from "./ruby-extension";
export { rustLanguage } from "./rust-extension";
export { tomlLanguage } from "./toml-extension";
export { typescriptLanguage } from "./typescript-extension";
export { yamlLanguage } from "./yaml-extension";

// New languages - temporarily disabled due to tree-sitter version conflicts
// export { kotlinLanguage } from "./kotlin-extension";
// export { swiftLanguage } from "./swift-extension";
// export { csharpLanguage } from "./csharp-extension";
// export { zigLanguage } from "./zig-extension";
// export { elixirLanguage } from "./elixir-extension";
// export { dartLanguage } from "./dart-extension";
// export { sqlLanguage } from "./sql-extension";

export type { LanguageConfig } from "./language-provider";
// Re-export types
export { BaseLanguageProvider } from "./language-provider";

// import { kotlinLanguage } from "./kotlin-extension";
// import { swiftLanguage } from "./swift-extension";
// import { csharpLanguage } from "./csharp-extension";
// import { zigLanguage } from "./zig-extension";
// import { elixirLanguage } from "./elixir-extension";
// import { dartLanguage } from "./dart-extension";
// import { sqlLanguage } from "./sql-extension";
import type { LanguageExtension } from "../extension-types";
import { bashLanguage } from "./bash-extension";
import { cLanguage } from "./c-extension";
import { cppLanguage } from "./cpp-extension";
import { cssLanguage } from "./css-extension";
import { erbLanguage } from "./erb-extension";
import { goLanguage } from "./go-extension";
import { htmlLanguage } from "./html-extension";
import { javaLanguage } from "./java-extension";
// All languages array for easy registration
import { javascriptLanguage } from "./javascript-extension";
import { jsonLanguage } from "./json-extension";
import { markdownLanguage } from "./markdown-extension";
import { phpLanguage } from "./php-extension";
import { pythonLanguage } from "./python-extension";
import { rubyLanguage } from "./ruby-extension";
import { rustLanguage } from "./rust-extension";
import { tomlLanguage } from "./toml-extension";
import { typescriptLanguage } from "./typescript-extension";
import { yamlLanguage } from "./yaml-extension";

export const allLanguages: LanguageExtension[] = [
  // Existing languages (18 total)
  javascriptLanguage,
  typescriptLanguage,
  pythonLanguage,
  rustLanguage,
  goLanguage,
  javaLanguage,
  cLanguage,
  cppLanguage,
  rubyLanguage,
  phpLanguage,
  htmlLanguage,
  cssLanguage,
  jsonLanguage,
  yamlLanguage,
  tomlLanguage,
  markdownLanguage,
  bashLanguage,
  erbLanguage,
  // New languages - temporarily disabled due to tree-sitter version conflicts
  // kotlinLanguage,
  // swiftLanguage,
  // csharpLanguage,
  // zigLanguage,
  // elixirLanguage,
  // dartLanguage,
  // sqlLanguage,
];
