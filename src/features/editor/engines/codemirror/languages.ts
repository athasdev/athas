import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

export type LanguageLoader = () => Promise<LanguageSupport>;

const legacy =
  <T>(load: () => Promise<StreamParser<T>>): LanguageLoader =>
  () =>
    load().then((parser) => new LanguageSupport(StreamLanguage.define(parser)));

const legacyMode = {
  shell: legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell)),
  properties: legacy(() =>
    import("@codemirror/legacy-modes/mode/properties").then((m) => m.properties),
  ),
  commonLisp: legacy(() =>
    import("@codemirror/legacy-modes/mode/commonlisp").then((m) => m.commonLisp),
  ),
  stex: legacy(() => import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex)),
  verilog: legacy(() => import("@codemirror/legacy-modes/mode/verilog").then((m) => m.verilog)),
};

const javascript = (options: { typescript?: boolean; jsx?: boolean }) => () =>
  import("@codemirror/lang-javascript").then((m) => m.javascript(options));
const html = () => import("@codemirror/lang-html").then((m) => m.html());
const json = () => import("@codemirror/lang-json").then((m) => m.json());
const sql = () => import("@codemirror/lang-sql").then((m) => m.sql());
const cpp = () => import("@codemirror/lang-cpp").then((m) => m.cpp());
const markdown = () =>
  import("@codemirror/lang-markdown").then(async (m) => {
    const { languages } = await import("./language-data");
    return m.markdown({ codeLanguages: languages });
  });
const athas = <K extends string>(load: () => Promise<Record<K, StreamParser<unknown>>>, key: K) =>
  legacy(() => load().then((m) => m[key]));
const configFiles = () => import("./languages/config-files");

/**
 * Athas language ids, as `getLanguageIdFromPath` returns them or a language override names them,
 * mapped to CodeMirror support.
 */
export const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  javascript: javascript({}),
  javascriptreact: javascript({ jsx: true }),
  typescript: javascript({ typescript: true }),
  typescriptreact: javascript({ typescript: true, jsx: true }),
  rescript: javascript({}),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  html,
  svelte: html,
  astro: html,
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-sass").then((m) => m.sass()),
  sass: () => import("@codemirror/lang-sass").then((m) => m.sass({ indented: true })),
  less: () => import("@codemirror/lang-less").then((m) => m.less()),
  json,
  jsonc: json,
  "jupyter-notebook": json,
  markdown,
  mdx: markdown,
  rmarkdown: markdown,
  rmd: markdown,
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  c: cpp,
  cpp,
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  sql,
  ql: sql,
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  vue: () => import("@codemirror/lang-vue").then((m) => m.vue()),
  angular: () => import("@codemirror/lang-angular").then((m) => m.angular()),
  bash: legacyMode.shell,
  shell: legacyMode.shell,
  dotenv: legacyMode.shell,
  dockerfile: legacy(() =>
    import("@codemirror/legacy-modes/mode/dockerfile").then((m) => m.dockerFile),
  ),
  ruby: legacy(() => import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby)),
  lua: legacy(() => import("@codemirror/legacy-modes/mode/lua").then((m) => m.lua)),
  swift: legacy(() => import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift)),
  kotlin: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.kotlin)),
  scala: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.scala)),
  csharp: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp)),
  objc: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.objectiveC)),
  dart: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.dart)),
  toml: legacy(() => import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml)),
  diff: legacy(() => import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff)),
  r: legacy(() => import("@codemirror/legacy-modes/mode/r").then((m) => m.r)),
  elm: legacy(() => import("@codemirror/legacy-modes/mode/elm").then((m) => m.elm)),
  scheme: legacy(() => import("@codemirror/legacy-modes/mode/scheme").then((m) => m.scheme)),
  elisp: legacyMode.commonLisp,
  lisp: legacyMode.commonLisp,
  clojure: legacy(() => import("@codemirror/legacy-modes/mode/clojure").then((m) => m.clojure)),
  ocaml: legacy(() => import("@codemirror/legacy-modes/mode/mllike").then((m) => m.oCaml)),
  fsharp: legacy(() => import("@codemirror/legacy-modes/mode/mllike").then((m) => m.fSharp)),
  haskell: legacy(() => import("@codemirror/legacy-modes/mode/haskell").then((m) => m.haskell)),
  erlang: legacy(() => import("@codemirror/legacy-modes/mode/erlang").then((m) => m.erlang)),
  julia: legacy(() => import("@codemirror/legacy-modes/mode/julia").then((m) => m.julia)),
  perl: legacy(() => import("@codemirror/legacy-modes/mode/perl").then((m) => m.perl)),
  groovy: legacy(() => import("@codemirror/legacy-modes/mode/groovy").then((m) => m.groovy)),
  nginx: legacy(() => import("@codemirror/legacy-modes/mode/nginx").then((m) => m.nginx)),
  powershell: legacy(() =>
    import("@codemirror/legacy-modes/mode/powershell").then((m) => m.powerShell),
  ),
  cmake: legacy(() => import("@codemirror/legacy-modes/mode/cmake").then((m) => m.cmake)),
  latex: legacyMode.stex,
  tex: legacyMode.stex,
  verilog: legacyMode.verilog,
  systemverilog: legacyMode.verilog,
  protobuf: legacy(() => import("@codemirror/legacy-modes/mode/protobuf").then((m) => m.protobuf)),
  ini: legacyMode.properties,
  properties: legacyMode.properties,
  gitignore: athas(configFiles, "gitignore"),
  gitattributes: athas(configFiles, "gitattributes"),
  lockfile: athas(configFiles, "lockfile"),
  batch: athas(configFiles, "batch"),
  vim: athas(configFiles, "vimscript"),
  restructuredtext: athas(configFiles, "restructuredText"),
  zig: athas(() => import("./languages/zig"), "zig"),
  nix: athas(() => import("./languages/nix"), "nix"),
  elixir: athas(() => import("./languages/elixir"), "elixir"),
  graphql: athas(() => import("./languages/graphql"), "graphql"),
  terraform: athas(() => import("./languages/hcl"), "hcl"),
  solidity: athas(() => import("./languages/solidity"), "solidity"),
  makefile: athas(() => import("./languages/makefile"), "makefile"),
  embedded_template: legacy(() => import("./languages/erb").then((m) => m.erb)),
};

/**
 * Other names for the same languages: ids from language extensions, Monaco and editor modelines,
 * so a language override or an extension's id still finds its highlighting.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  c_sharp: "csharp",
  "objective-c": "objc",
  objectivec: "objc",
  shellscript: "bash",
  sh: "bash",
  zsh: "bash",
  hcl: "terraform",
  tf: "terraform",
  "terraform-vars": "terraform",
  sol: "solidity",
  erb: "embedded_template",
  make: "makefile",
  commonlisp: "lisp",
  "emacs-lisp": "elisp",
  bat: "batch",
  cmd: "batch",
  viml: "vim",
  rst: "restructuredtext",
  yml: "yaml",
  proto: "protobuf",
  ps1: "powershell",
  docker: "dockerfile",
  ignore: "gitignore",
  "git-commit": "diff",
  patch: "diff",
};

/** The `LANGUAGE_LOADERS` key for an Athas language id or one of its aliases. */
export function resolveCodeMirrorLanguageId(languageId: string | null | undefined): string | null {
  if (!languageId) return null;
  if (LANGUAGE_LOADERS[languageId]) return languageId;
  const lower = languageId.toLowerCase();
  if (LANGUAGE_LOADERS[lower]) return lower;
  const alias = LANGUAGE_ALIASES[lower];
  return alias && LANGUAGE_LOADERS[alias] ? alias : null;
}

const loaded = new Map<string, Promise<LanguageSupport | null>>();

/** Whether CodeMirror has highlighting for an Athas language id. */
export function hasCodeMirrorLanguage(languageId: string | null | undefined) {
  return resolveCodeMirrorLanguageId(languageId) !== null;
}

/**
 * The CodeMirror language for an Athas language id, loaded once and shared by every editor.
 * Resolves to null for languages without CodeMirror support, which then show as plain text.
 */
export function loadCodeMirrorLanguage(
  languageId: string | null | undefined,
): Promise<LanguageSupport | null> {
  const id = resolveCodeMirrorLanguageId(languageId);
  if (!id) return Promise.resolve(null);
  let promise = loaded.get(id);
  if (!promise) {
    promise = LANGUAGE_LOADERS[id]().catch((error: unknown) => {
      loaded.delete(id);
      console.error(`Failed to load the ${id} language:`, error);
      return null;
    });
    loaded.set(id, promise);
  }
  return promise;
}

export type { LanguageSupport };
