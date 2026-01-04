import type { LanguageExtension } from "@/features/editor/extensions/types";
import { bashLanguage } from "./bash-extension";
import { cLanguage } from "./c-extension";
import { cppLanguage } from "./cpp-extension";
import { cssLanguage } from "./css-extension";
import { erbLanguage } from "./erb-extension";
import { goLanguage } from "./go-extension";
import { htmlLanguage } from "./html-extension";
import { javaLanguage } from "./java-extension";
import { javascriptLanguage } from "./javascript-extension";
import { jsonLanguage } from "./json-extension";
import { markdownLanguage } from "./markdown-extension";
import { phpLanguage } from "./php-extension";
import { pythonLanguage } from "./python-extension";
import { rubyLanguage } from "./ruby-extension";
import { tomlLanguage } from "./toml-extension";
import { typescriptLanguage } from "./typescript-extension";
import { yamlLanguage } from "./yaml-extension";

export const allLanguages: LanguageExtension[] = [
  javascriptLanguage,
  typescriptLanguage,
  pythonLanguage,
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
];
