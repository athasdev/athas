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
  css: "css",
  scss: "css",
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
  sol: "solidity",
  zig: "zig",
  vue: "vue",
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
    default:
      return languageId;
  }
}

export function getLanguageIdFromExtension(extension: string): string | null {
  const normalized = extension.replace(/^\./, "").toLowerCase();
  return EXTENSION_TO_LANGUAGE[normalized] || null;
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
