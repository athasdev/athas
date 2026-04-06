import { extensionRegistry } from "@/extensions/registry/extension-registry";

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  ts: "typescript",
  tsx: "typescriptreact",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  html: "html",
  htm: "html",
  xml: "html",
  xsl: "html",
  xslt: "html",
  svg: "html",
  plist: "html",
  css: "css",
  scss: "css",
  diff: "diff",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  patch: "diff",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  lua: "lua",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  ml: "ocaml",
  mli: "ocaml",
  sql: "sql",
  sol: "solidity",
  zig: "zig",
  vue: "vue",
  svelte: "svelte",
  erb: "embedded_template",
};

const FILENAME_TO_LANGUAGE: Record<string, string> = {
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".bash_profile": "bash",
  ".profile": "bash",
  "go.mod": "go",
  "go.sum": "go",
  "go.work": "go",
};

export function normalizeLanguageId(languageId: string): string {
  switch (languageId) {
    case "jsonc":
      return "json";
    case "c_sharp":
      return "csharp";
    case "mdx":
      return "markdown";
    default:
      return languageId;
  }
}

export function getLanguageIdFromExtension(extension: string): string | null {
  const normalized = extension.replace(/^\./, "").toLowerCase();
  return EXTENSION_TO_LANGUAGE[normalized] || null;
}

export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  javascript: "JavaScript",
  javascriptreact: "JSX",
  typescript: "TypeScript",
  typescriptreact: "TSX",
  python: "Python",
  rust: "Rust",
  go: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  ruby: "Ruby",
  php: "PHP",
  html: "HTML",
  css: "CSS",
  diff: "Diff",
  json: "JSON",
  yaml: "YAML",
  toml: "TOML",
  markdown: "Markdown",
  bash: "Bash",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
  lua: "Lua",
  dart: "Dart",
  elixir: "Elixir",
  ocaml: "OCaml",
  sql: "SQL",
  solidity: "Solidity",
  zig: "Zig",
  vue: "Vue",
  svelte: "Svelte",
  embedded_template: "ERB",
  text: "Plain Text",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  cmake: "CMake",
  gitignore: "Git Ignore",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  xml: "XML",
  restructuredtext: "reStructuredText",
  latex: "LaTeX",
  haskell: "Haskell",
  fsharp: "F#",
  clojure: "Clojure",
  lisp: "Lisp",
  scheme: "Scheme",
  shell: "Shell",
  powershell: "PowerShell",
  batch: "Batch",
  ini: "INI",
  csv: "CSV",
  r: "R",
  vim: "Vim",
  elm: "Elm",
};

export function getLanguageDisplayName(languageId: string): string {
  return LANGUAGE_DISPLAY_NAMES[languageId] || languageId;
}

export function getAllLanguages(): Array<{ id: string; displayName: string }> {
  return Object.entries(LANGUAGE_DISPLAY_NAMES)
    .map(([id, displayName]) => ({ id, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function getLanguageIdFromPath(filePath: string): string | null {
  const fromRegistry = extensionRegistry.getLanguageId(filePath);
  if (fromRegistry) {
    return normalizeLanguageId(fromRegistry);
  }

  const fileName = filePath.split("/").pop()?.toLowerCase() || "";
  const fromFilename = FILENAME_TO_LANGUAGE[fileName];
  if (fromFilename) {
    return fromFilename;
  }

  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  return getLanguageIdFromExtension(extension);
}
