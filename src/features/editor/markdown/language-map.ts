export const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  jsx: "jsx",
  tsx: "tsx",
  py: "python",
  r: "r",
  rmd: "r",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  fish: "bash",
  env: "dotenv",
  dotenv: "dotenv",
  yml: "yaml",
  md: "markdown",
  mdx: "markdown",
  cs: "csharp",
  kt: "kotlin",
  cpp: "cpp",
  cc: "cpp",
  "c++": "cpp",
  cxx: "cpp",
  hpp: "cpp",
  h: "c",
  dockerfile: "docker",
  tf: "hcl",
  hcl: "hcl",
  vue: "markup",
  svelte: "markup",
  html: "markup",
  xml: "markup",
  svg: "markup",
  htm: "markup",
  objc: "objectivec",
  "objective-c": "objectivec",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  gql: "graphql",
  tex: "latex",
  mk: "makefile",
};

export function normalizeLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();
  return LANGUAGE_ALIASES[normalized] || normalized;
}

export function normalizeCodeFenceLanguage(infoString: string): string {
  const normalized = infoString.trim();
  const bracedLanguage = normalized.match(/^\{\s*([A-Za-z0-9_+-]+)(?:\s+[^}]*)?\}$/);

  if (bracedLanguage?.[1]) {
    return normalizeLanguage(bracedLanguage[1]);
  }

  const [language] = normalized.split(/\s+/);
  return normalizeLanguage(language || "plaintext");
}
