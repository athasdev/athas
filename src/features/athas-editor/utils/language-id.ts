import { extensionRegistry } from "@/extensions/registry/extension-registry";
import {
  ANGULAR_TEMPLATE_LANGUAGE_ID,
  isAngularTemplatePath,
} from "@/features/editor/lib/wasm-parser/language-overlays";

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
  xml: "xml",
  xsl: "xml",
  xslt: "xml",
  xsd: "xml",
  dtd: "xml",
  wsdl: "xml",
  svg: "xml",
  plist: "xml",
  csproj: "xml",
  vbproj: "xml",
  fsproj: "xml",
  props: "xml",
  targets: "xml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  dockerfile: "dockerfile",
  dockerignore: "gitignore",
  diff: "diff",
  gitattributes: "gitattributes",
  gitignore: "gitignore",
  ignore: "gitignore",
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
  nix: "nix",
  scm: "scheme",
  dart: "dart",
  el: "elisp",
  elm: "elm",
  graphql: "graphql",
  gql: "graphql",
  ex: "elixir",
  exs: "elixir",
  ml: "ocaml",
  mli: "ocaml",
  proto: "protobuf",
  ql: "ql",
  qll: "ql",
  sql: "sql",
  sol: "solidity",
  tf: "terraform",
  tfvars: "terraform",
  zig: "zig",
  vue: "vue",
  svelte: "svelte",
  erb: "embedded_template",
  lock: "lockfile",
};

const FILENAME_TO_LANGUAGE: Record<string, string> = {
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".bash_profile": "bash",
  ".profile": "bash",
  ".dockerignore": "gitignore",
  ".eslintignore": "gitignore",
  ".fdignore": "gitignore",
  ".gitattributes": "gitattributes",
  ".gitignore": "gitignore",
  ".ignore": "gitignore",
  ".npmignore": "gitignore",
  ".prettierignore": "gitignore",
  ".rgignore": "gitignore",
  ".stylelintignore": "gitignore",
  ".vscodeignore": "gitignore",
  containerfile: "dockerfile",
  dockerfile: "dockerfile",
  "go.mod": "go",
  "go.sum": "go",
  "go.work": "go",
};

function isEnvFileName(fileName: string): boolean {
  return fileName === ".env" || fileName.startsWith(".env.");
}

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
  [ANGULAR_TEMPLATE_LANGUAGE_ID]: "Angular Template",
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
  dotenv: "Dotenv",
  json: "JSON",
  yaml: "YAML",
  toml: "TOML",
  markdown: "Markdown",
  bash: "Bash",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
  lua: "Lua",
  nix: "Nix",
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
  gitattributes: "Git Attributes",
  graphql: "GraphQL",
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
  protobuf: "Protocol Buffers",
  ql: "QL",
  r: "R",
  terraform: "Terraform",
  vim: "Vim",
  elm: "Elm",
  elisp: "Emacs Lisp",
  lockfile: "Lockfile",
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
  if (isAngularTemplatePath(filePath)) {
    return ANGULAR_TEMPLATE_LANGUAGE_ID;
  }

  const fromRegistry = extensionRegistry.getLanguageId(filePath);
  if (fromRegistry) {
    return normalizeLanguageId(fromRegistry);
  }

  const fileName = filePath.split("/").pop()?.toLowerCase() || "";
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  if (normalizedPath.endsWith("/.git/info/exclude")) {
    return "gitignore";
  }
  if (normalizedPath.endsWith("/.git/info/attributes")) {
    return "gitattributes";
  }

  if (isEnvFileName(fileName)) {
    return "dotenv";
  }

  const fromFilename = FILENAME_TO_LANGUAGE[fileName];
  if (fromFilename) {
    return fromFilename;
  }

  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  return getLanguageIdFromExtension(extension);
}
